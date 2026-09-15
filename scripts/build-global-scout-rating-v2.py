#!/usr/bin/env python3
"""Build universal Global Scout Rating + fighter dossiers from completed MMA history.

Rules:
- Every promotion uses the same fight-graph rules. Promotion prestige never adds points.
- Only completed outcomes on/before the run date become evidence.
- Same-name fighters are resolved conservatively with fight-row gym/nationality/height metadata.
- UFC-style technical stats are optional enrichment and are not required by the global rating.
- Weight coefficients are fitted on historical pre-fight state and checked forward from 2024.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import unicodedata
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

SOURCE_KEY = "leandroiber_mmastats"
MODEL_VERSION = "global-1.0.0"
VALIDATION_START = "2024-01-01"
FEATURES = ("global_skill", "resume_quality", "schedule_strength", "recent_form", "finishing_quality")
ROWS_PER_INSERT = 100
MAX_SQL_FILE_BYTES = 900_000


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def slugify(value: Any) -> str:
    return (norm(value).replace(" ", "-")[:120].strip("-") or "fighter")


def sql(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return "NULL" if not math.isfinite(value) else repr(round(value, 8))
    return "'" + str(value).replace("'", "''") + "'"


def first(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            return value
    return None


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in {"1", "true", "t", "yes", "y"}


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-min(60, value))
        return 1 / (1 + z)
    z = math.exp(max(-60, value))
    return z / (1 + z)


def elo_expected(a: float, b: float) -> float:
    return 1 / (1 + 10 ** ((b - a) / 400))


def score_elo(value: float) -> float:
    return clamp(100 * sigmoid((value - 1500) / 260), 5, 97)


def score_form(value: float) -> float:
    return clamp(50 + 115 * value, 5, 95)


def quality(elo: float) -> float:
    return sigmoid((elo - 1500) / 240)


def score_finish(value: float) -> float:
    return clamp(20 + 85 * value, 5, 95)


def wmean(items: Iterable[tuple[float, float]], fallback: float = 0.0) -> float:
    num = den = 0.0
    for value, weight in items:
        if math.isfinite(value) and weight > 0:
            num += value * weight
            den += weight
    return num / den if den else fallback


def event_day(row: dict[str, Any]) -> str:
    return str(row.get("event_date") or "")[:10]


def method_text(row: dict[str, Any]) -> str:
    return str(first(row, "method_normalized", "method", "method_raw") or "")


def outcome(row: dict[str, Any]) -> tuple[str, str] | None:
    side = as_int(row.get("winner_side"), 0)
    if side == 1:
        return ("W", "L")
    if side == 2:
        return ("L", "W")
    raw = norm(f"{row.get('method') or ''} {row.get('method_normalized') or ''}")
    if "no contest" in raw or "overturned" in raw:
        return ("NC", "NC")
    if "draw" in raw:
        return ("D", "D")
    return None


def finish_type(method: Any) -> str | None:
    text = norm(method)
    if "submission" in text or text.startswith("sub"):
        return "SUB"
    if "ko" in text or "tko" in text:
        return "KO"
    if "decision" in text:
        return "DEC"
    return None


class IdentityResolver:
    def __init__(self, fighters: list[dict[str, Any]]):
        self.by_id = {str(f["fighter_id"]): f for f in fighters}
        self.by_norm: dict[str, list[str]] = defaultdict(list)
        self.by_exact: dict[str, list[str]] = defaultdict(list)
        for f in fighters:
            fid = str(f["fighter_id"])
            self.by_norm[norm(f.get("fighter_name"))].append(fid)
            self.by_exact[str(f.get("fighter_name") or "").strip().casefold()].append(fid)

    def resolve(self, name: Any, fight: dict[str, Any], side: int) -> str | None:
        exact = self.by_exact.get(str(name or "").strip().casefold(), [])
        candidates = exact or self.by_norm.get(norm(name), [])
        if len(candidates) == 1:
            return candidates[0]
        if not candidates:
            return None
        gym = norm(first(fight, f"f{side}_gym"))
        nationality = norm(first(fight, f"f{side}_nationality"))
        height = first(fight, f"f{side}_height_cm")
        try:
            height = float(height) if height not in (None, "") else None
        except (TypeError, ValueError):
            height = None
        scored: list[tuple[float, str]] = []
        for fid in candidates:
            f = self.by_id[fid]
            value = 0.0
            if gym and gym == norm(f.get("gym")):
                value += 4
            if nationality and nationality == norm(f.get("nationality")):
                value += 3
            if height is not None and f.get("height_cm") not in (None, ""):
                try:
                    diff = abs(height - float(f["height_cm"]))
                    value += 2 if diff <= 2 else 1 if diff <= 5 else 0
                except (TypeError, ValueError):
                    pass
            scored.append((value, fid))
        scored.sort(reverse=True)
        if not scored or scored[0][0] < 2:
            return None
        if len(scored) > 1 and abs(scored[0][0] - scored[1][0]) < 1e-9:
            return None
        return scored[0][1]


@dataclass
class FighterState:
    elo: float = 1500.0
    bouts: int = 0
    wins: int = 0
    opponent_ids: set[str] = field(default_factory=set)
    opponent_elos: list[tuple[float, str]] = field(default_factory=list)
    quality_wins: list[tuple[float, str, bool]] = field(default_factory=list)
    recent: deque = field(default_factory=lambda: deque(maxlen=8))

    def metrics(self) -> tuple[float, float, float, float, float]:
        skill = self.elo
        if self.quality_wins:
            top = sorted((elo for elo, _, _ in self.quality_wins), reverse=True)[:5]
            resume = sum(top) / len(top) + min(80, 18 * math.log1p(len(self.quality_wins)))
        else:
            resume = 1425.0
        recent_opps = self.opponent_elos[-10:]
        schedule = wmean(((elo, 1 / (1 + i * .12)) for i, (elo, _) in enumerate(reversed(recent_opps))), 1450.0)
        form = wmean(((residual, 1 / (1 + i * .32)) for i, (_, residual, _, _) in enumerate(reversed(self.recent))), 0.0)
        finish = sum(quality(opp) for opp, _, ended in self.quality_wins if ended) / (max(1, self.wins) + 1.5)
        return skill, resume, schedule, form, finish

    def evidence(self) -> float:
        bout_rel = 1 - math.exp(-self.bouts / 7)
        opp_rel = 1 - math.exp(-len(self.opponent_ids) / 7)
        return 100 * clamp(.72 * bout_rel + .28 * opp_rel, .08, .995)


@dataclass
class ValidationRow:
    fight_date: str
    x: tuple[float, ...]
    y: int
    elo_p: float


class SqlWriter:
    def __init__(self, directory: Path, prefix: int, stem: str):
        self.directory, self.prefix, self.stem = directory, prefix, stem
        self.part = 0
        self.lines: list[str] = []
        self.bytes = 0
        self.files: list[str] = []

    def add(self, statement: str) -> None:
        size = len(statement.encode())
        if self.lines and self.bytes + size > MAX_SQL_FILE_BYTES:
            self.flush()
        self.lines.append(statement if statement.endswith("\n") else statement + "\n")
        self.bytes += size + 1

    def flush(self) -> None:
        if not self.lines:
            return
        name = f"{self.prefix + self.part:04d}-{self.stem}.sql"
        (self.directory / name).write_text("BEGIN;\n" + "".join(self.lines) + "COMMIT;\n", encoding="utf-8")
        self.files.append(name)
        self.part += 1
        self.lines, self.bytes = [], 0


def insert_sql(table: str, columns: list[str], batch: list[list[Any]]) -> str:
    values = ",\n".join("(" + ",".join(sql(v) for v in row) + ")" for row in batch)
    return f"INSERT OR REPLACE INTO {table} ({','.join(columns)}) VALUES\n{values};\n"


def write_batches(writer: SqlWriter, table: str, columns: list[str], rows: list[list[Any]]) -> None:
    for i in range(0, len(rows), ROWS_PER_INSERT):
        writer.add(insert_sql(table, columns, rows[i:i + ROWS_PER_INSERT]))
    writer.flush()


def table_rows(con, table: str, order: str = "") -> list[dict[str, Any]]:
    cur = con.execute(f"SELECT * FROM {table} {order}")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def promotion_data(path: Path) -> tuple[dict[str, Any], dict[str, str]]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    aliases: dict[str, str] = {}
    for p in rows:
        for alias in p.get("aliases", []):
            aliases[norm(alias)] = p["slug"]
    return {p["slug"]: p for p in rows}, aliases


def fit(rows: list[ValidationRow], split: str) -> tuple[list[float], list[float]]:
    train = [r for r in rows if r.fight_date < split]
    if len(train) < 1000:
        raise RuntimeError(f"Too few pre-{split} training examples: {len(train)}")
    scales = [statistics.pstdev([r.x[j] for r in train]) or 1.0 for j in range(len(FEATURES))]
    beta = [max(.03, scales[0] * math.log(10) / 400)] + [.08] * (len(FEATURES) - 1)
    # Mirrored examples remove side-order bias. 260 projected steps were stable in the full-data audit.
    for step in range(260):
        grad = [0.0] * len(FEATURES)
        for r in train:
            z = [r.x[j] / scales[j] for j in range(len(FEATURES))]
            p = sigmoid(sum(beta[j] * z[j] for j in range(len(FEATURES))))
            err = p - r.y
            for j in range(len(FEATURES)):
                grad[j] += err * z[j]
        lr = .18 / math.sqrt(1 + step / 80)
        n = len(train)
        for j in range(len(FEATURES)):
            beta[j] = max(0.0, beta[j] - lr * (grad[j] / n + .012 * beta[j]))
    return beta, scales


def evaluate(rows: list[ValidationRow], beta: list[float] | None = None, scales: list[float] | None = None) -> dict[str, float]:
    loss = brier = correct = 0.0
    for r in rows:
        p = r.elo_p if beta is None else sigmoid(sum(beta[j] * (r.x[j] / scales[j]) for j in range(len(beta))))
        p = clamp(p, 1e-6, 1 - 1e-6)
        loss += -(r.y * math.log(p) + (1 - r.y) * math.log(1 - p))
        brier += (p - r.y) ** 2
        correct += int((p >= .5) == bool(r.y))
    n = max(1, len(rows))
    return {"fights": len(rows) // 2, "examples": len(rows), "log_loss": loss / n, "brier": brier / n, "accuracy": correct / n}


def weights(beta: list[float]) -> dict[str, float]:
    total = sum(beta)
    raw = {FEATURES[i]: (beta[i] / total if total else 0) for i in range(len(FEATURES))}
    if raw["global_skill"] < .45:
        others = sum(raw[k] for k in FEATURES[1:]) or 1
        raw = {"global_skill": .45, **{k: raw[k] / others * .55 for k in FEATURES[1:]}}
    return raw


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--summary", default=".cache/mma-master/summary.json")
    ap.add_argument("--output", default=".cache/mma-master/sql")
    ap.add_argument("--promotions", default="scripts/data/scout-promotions.json")
    ap.add_argument("--validation-start", default=VALIDATION_START)
    args = ap.parse_args()

    import duckdb
    source, summary_path, output = Path(args.source).resolve(), Path(args.summary), Path(args.output)
    base = json.loads(summary_path.read_text(encoding="utf-8"))
    snapshot = base["snapshot_id"]
    source_day = date.fromisoformat(str(base["source_max_date"])[:10])
    run_day = datetime.now(timezone.utc).date()
    as_of = min(source_day, run_day).isoformat()
    today = date.fromisoformat(as_of)
    promotions, aliases = promotion_data(Path(args.promotions))
    con = duckdb.connect(str(source), read_only=True)
    fighters = table_rows(con, "fighters_master", "ORDER BY fighter_id")
    fights = table_rows(con, "fights_career_longitudinal", "ORDER BY event_date, fight_id")
    resolver = IdentityResolver(fighters)

    states: dict[str, FighterState] = defaultdict(FighterState)
    history: dict[str, list[dict[str, Any]]] = defaultdict(list)
    validation: list[ValidationRow] = []
    unresolved = unknown = decisive = completed = metadata_resolved = 0
    recent_orgs: dict[str, int] = defaultdict(int)

    for row in fights:
        d = event_day(row)
        if not d or d > as_of:
            continue
        pair_result = outcome(row)
        if pair_result is None:
            unknown += 1
            continue
        completed += 1
        a_name, b_name = first(row, "fighter_1"), first(row, "fighter_2")
        a = resolver.resolve(a_name, row, 1)
        b = resolver.resolve(b_name, row, 2)
        if not a or not b or a == b:
            unresolved += 1
            continue
        exact_a = len(resolver.by_norm.get(norm(a_name), [])) == 1
        exact_b = len(resolver.by_norm.get(norm(b_name), [])) == 1
        metadata_resolved += int(not exact_a) + int(not exact_b)
        ra, rb = pair_result
        sa, sb = states[a], states[b]
        ma, mb = sa.metrics(), sb.metrics()
        p = elo_expected(sa.elo, sb.elo)
        if ra in ("W", "L"):
            x = tuple(ma[j] - mb[j] for j in range(len(FEATURES)))
            y = 1 if ra == "W" else 0
            validation.append(ValidationRow(d, x, y, p))
            validation.append(ValidationRow(d, tuple(-v for v in x), 1 - y, 1 - p))
            decisive += 1

        org = str(first(row, "organization") or "unknown")
        promotion_slug = aliases.get(norm(org))
        try:
            if (today - date.fromisoformat(d)).days <= 730:
                recent_orgs[norm(org)] += 1
        except ValueError:
            pass
        method = method_text(row)
        finish = finish_type(method) in ("KO", "SUB")
        common = {
            "fight_id": str(row.get("fight_id")), "date": d, "organization": org, "promotion_slug": promotion_slug,
            "event_name": first(row, "event_name"), "event_location": first(row, "event_location"),
            "weight_class": first(row, "weight_class"), "title": as_bool(first(row, "is_title_fight")),
            "method": method, "round_num": first(row, "round_num"), "time_finish_seconds": first(row, "time_finish_seconds"),
        }
        history[a].append({**common, "result": ra, "opponent_id": b, "opponent_name": str(b_name or ""), "opponent_pre_elo": sb.elo, "finish_win": ra == "W" and finish})
        history[b].append({**common, "result": rb, "opponent_id": a, "opponent_name": str(a_name or ""), "opponent_pre_elo": sa.elo, "finish_win": rb == "W" and finish})
        for state, opp_id, opp_elo in ((sa, b, sb.elo), (sb, a, sa.elo)):
            state.bouts += 1
            state.opponent_ids.add(opp_id)
            state.opponent_elos.append((opp_elo, d))
        if ra in ("W", "L"):
            a_win = 1 if ra == "W" else 0
            residual_a = a_win - p
            residual_b = (1 - a_win) - (1 - p)
            sa.recent.append((d, residual_a, sb.elo, ra == "W" and finish))
            sb.recent.append((d, residual_b, sa.elo, rb == "W" and finish))
            if ra == "W":
                sa.wins += 1; sa.quality_wins.append((sb.elo, d, finish))
            else:
                sb.wins += 1; sb.quality_wins.append((sa.elo, d, finish))
            k = 28 * (1.12 if finish else 1.0)
            delta = k * (a_win - p)
            sa.elo += delta; sb.elo -= delta

    beta, scales = fit(validation, args.validation_start)
    fitted = weights(beta)
    holdout = [r for r in validation if r.fight_date >= args.validation_start]
    elo_eval, combined_eval = evaluate(holdout), evaluate(holdout, beta, scales)

    scored: dict[str, dict[str, Any]] = {}
    for fid, state in states.items():
        if not history.get(fid):
            continue
        raw = state.metrics()
        components = {
            "global_skill": score_elo(raw[0]), "resume_quality": score_elo(raw[1]), "schedule_strength": score_elo(raw[2]),
            "recent_form": score_form(raw[3]), "finishing_quality": score_finish(raw[4]),
        }
        evidence = state.evidence()
        base_score = sum(fitted[k] * components[k] for k in FEATURES)
        rating = clamp(50 + (base_score - 50) * (.30 + .70 * evidence / 100), 5, 97)
        scored[fid] = {"rating": rating, "components": components, "evidence": evidence, "elo": state.elo, "weight_class": history[fid][-1].get("weight_class") or "Unknown"}

    global_ids = sorted(scored, key=lambda fid: scored[fid]["rating"], reverse=True)
    global_rank = {fid: i + 1 for i, fid in enumerate(global_ids)}
    division_rank: dict[str, int] = {}
    divisions: dict[str, list[str]] = defaultdict(list)
    for fid, s in scored.items(): divisions[s["weight_class"]].append(fid)
    for ids in divisions.values():
        ids.sort(key=lambda fid: scored[fid]["rating"], reverse=True)
        for i, fid in enumerate(ids): division_rank[fid] = i + 1

    profile_rows: list[list[Any]] = []
    rating_rows: list[list[Any]] = []
    fight_rows: list[list[Any]] = []
    roster_counts: dict[str, int] = defaultdict(int)
    slug_count: dict[str, int] = defaultdict(int)
    profile_slug_by_id: dict[str, str] = {}

    # Every fighter_master row becomes a profile, even if its fight identity is still unresolved.
    for f in fighters:
        fid = str(f["fighter_id"]); rows = sorted(history.get(fid, []), key=lambda x: x["date"])
        base_slug = slugify(f.get("fighter_name")); slug_count[base_slug] += 1
        duplicates = len(resolver.by_norm.get(norm(f.get("fighter_name")), [])) > 1 or slug_count[base_slug] > 1
        suffix = re.sub(r"[^A-Za-z0-9]+", "", fid)[-8:].lower()
        profile_slug = f"{base_slug}-{suffix}" if duplicates else base_slug
        profile_slug_by_id[fid] = profile_slug
        counts = {"W":0,"L":0,"D":0,"NC":0}; kos=subs=decs=titles=title_wins=recent=recent_wins=0; orgs=set()
        finish_round_sum=first_round_finishes=times_finished=0
        latest = rows[-1] if rows else None
        for h in rows:
            counts[h["result"]] += 1; orgs.add(norm(h["organization"])); ft=finish_type(h["method"])
            if h["result"] == "W":
                kos += int(ft=="KO"); subs += int(ft=="SUB"); decs += int(ft=="DEC")
                if ft in ("KO","SUB"):
                    rn = h.get("round_num")
                    try: rn_int = int(rn) if rn not in (None,"") else None
                    except (TypeError, ValueError): rn_int = None
                    if rn_int is not None:
                        finish_round_sum += rn_int
                        first_round_finishes += int(rn_int == 1)
            elif h["result"] == "L" and ft in ("KO","SUB"): times_finished += 1
            if h["title"]: titles += 1; title_wins += int(h["result"]=="W")
            try:
                if (today-date.fromisoformat(h["date"])).days <= 730: recent += 1; recent_wins += int(h["result"]=="W")
            except ValueError: pass
        promo = latest.get("promotion_slug") if latest else None
        if latest:
            try:
                if (today-date.fromisoformat(latest["date"])).days > 730: promo=None
            except ValueError: promo=None
        if promo: roster_counts[promo]+=1
        physical=[f.get("dob"),f.get("height_cm"),f.get("reach_cm"),f.get("stance"),f.get("nationality"),f.get("gym")]
        completeness=30+45*sum(v not in (None,"") for v in physical)/len(physical)+(25 if rows else 0)
        last5=rows[-5:]
        profile_rows.append([SOURCE_KEY,snapshot,fid,profile_slug,f.get("fighter_name"),norm(f.get("fighter_name")),f.get("dob"),f.get("height_cm"),f.get("reach_cm"),f.get("stance"),f.get("nationality"),f.get("gym"),rows[0]["date"] if rows else None,latest["date"] if latest else None,latest["organization"] if latest else None,promo,latest.get("weight_class") if latest else None,len(rows),counts["W"],counts["L"],counts["D"],counts["NC"],kos,subs,decs,titles,title_wins,len(orgs),recent,recent_wins,sum(x["result"]=="W" for x in last5),sum(x["result"]=="L" for x in last5),clamp(completeness,0,100),now_iso(),finish_round_sum,first_round_finishes,times_finished])
        if fid in scored:
            s=scored[fid]; c=s["components"]
            evidence={"career_bouts":len(rows),"unique_opponents":len(states[fid].opponent_ids),"best_wins":sorted([{"opponent":x["opponent_name"],"date":x["date"],"opponent_pre_elo":round(x["opponent_pre_elo"],1),"finish":x["finish_win"]} for x in rows if x["result"]=="W"],key=lambda x:x["opponent_pre_elo"],reverse=True)[:5],"recent":[{"date":x["date"],"opponent":x["opponent_name"],"result":x["result"],"organization":x["organization"]} for x in rows[-5:]]}
            rating_rows.append([SOURCE_KEY,snapshot,fid,MODEL_VERSION,as_of,s["rating"],c["global_skill"],c["resume_quality"],c["schedule_strength"],c["recent_form"],c["finishing_quality"],s["evidence"],s["elo"],division_rank.get(fid),global_rank.get(fid),json.dumps(fitted,separators=(",",":")),json.dumps(evidence,separators=(",",":"))])
        for h in rows:
            fight_rows.append([SOURCE_KEY,snapshot,fid,h["fight_id"],h["date"],h["organization"],h["promotion_slug"],h["event_name"],h["event_location"],h["weight_class"],h["result"],h["opponent_id"],h["opponent_name"],h["opponent_pre_elo"],int(h["title"]),h["method"],h["round_num"],h["time_finish_seconds"]])

    profile_cols=["source_key","snapshot_id","source_fighter_id","profile_slug","fighter_name","normalized_name","dob","height_cm","reach_cm","stance","nationality","gym","career_start_date","last_fight_date","current_organization","current_promotion_slug","current_weight_class","career_bouts","career_wins","career_losses","career_draws","career_no_contests","ko_tko_wins","submission_wins","decision_wins","title_fight_bouts","title_fight_wins","organization_count","recent_bouts_730d","recent_wins_730d","last_five_wins","last_five_losses","data_completeness","updated_at","finish_round_sum","first_round_finishes","times_finished"]
    rating_cols=["source_key","snapshot_id","source_fighter_id","model_version","as_of_date","scout_rating","global_skill","resume_quality","schedule_strength","recent_form","finishing_quality","evidence_strength","pre_fight_elo","division_rank","global_rank","model_weights_json","evidence_json"]
    fight_cols=["source_key","snapshot_id","source_fighter_id","source_fight_id","event_date","organization","promotion_slug","event_name","event_location","weight_class","result","opponent_source_fighter_id","opponent_name","opponent_pre_elo","is_title_fight","method","round_num","time_finish_seconds"]
    pw=SqlWriter(output,9000,"global-profiles"); write_batches(pw,"scout_global_profiles",profile_cols,profile_rows)
    fw=SqlWriter(output,9250,"global-fights"); write_batches(fw,"scout_global_fights",fight_cols,fight_rows)
    rw=SqlWriter(output,9500,"global-ratings"); write_batches(rw,"scout_global_ratings",rating_cols,rating_rows)
    train_through=(date.fromisoformat(args.validation_start)-timedelta(days=1)).isoformat()
    meta={"feature_order":FEATURES,"positive_logistic_beta":beta,"feature_scales":scales,"normalized_weights":fitted,"elo_baseline":elo_eval,"combined_model":combined_eval}
    model_row=[[MODEL_VERSION,"chronological global fight-graph Elo plus résumé, schedule, form and quality-finish components; positive logistic forward weight fit",train_through,args.validation_start,as_of,json.dumps(fitted,separators=(",",":")),json.dumps(meta,separators=(",",":")),"Promotion labels are metadata only; no promotion prestige multiplier. Technical stats are optional enrichment."]]
    (output/"9800-global-rating-model.sql").write_text("BEGIN;\n"+insert_sql("scout_rating_models",["model_version","algorithm","trained_through","validation_start","validation_end","weights_json","validation_json","notes"],model_row)+"COMMIT;\n",encoding="utf-8")

    top_recent=sorted(recent_orgs.items(),key=lambda x:x[1],reverse=True)[:100]
    audit={"model_version":MODEL_VERSION,"snapshot_id":snapshot,"as_of_date":as_of,"source_rows":len(fights),"completed_rows":completed,"decisive_fights":decisive,"unresolved_completed_rows":unresolved,"metadata_disambiguations":metadata_resolved,"profiles":len(profile_rows),"profiles_with_history":sum(bool(history.get(str(f["fighter_id"]))) for f in fighters),"ratings":len(rating_rows),"materialized_fighter_fights":len(fight_rows),"validation_start":args.validation_start,"weights":fitted,"elo_baseline":elo_eval,"combined_model":combined_eval,"promotion_roster_counts":dict(sorted(roster_counts.items())),"promotion_registry_count":len(promotions),"top_recent_organization_labels":top_recent,"generated_files":pw.files+fw.files+rw.files+["9800-global-rating-model.sql"],"generated_at":now_iso()}
    (summary_path.parent/"scout-global-summary.json").write_text(json.dumps(audit,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(audit,indent=2))

if __name__ == "__main__":
    main()
