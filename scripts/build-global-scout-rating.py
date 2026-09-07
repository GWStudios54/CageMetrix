#!/usr/bin/env python3
"""Build global MMA fighter dossiers and Scout Rating from the career fight graph.

The universal rating intentionally does not require UFC-style technical statistics.
It uses only evidence available across the global professional record: chronological
results, opponent strength, quality wins, schedule, recent over/under-performance,
finishing, and sample strength. Promotion names are metadata, never rating bonuses.

Weights are fitted on historical pre-fight features and checked on a forward
validation window against an Elo-only baseline. The generated model metadata keeps
that audit next to the materialized ratings.
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
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SOURCE_KEY = "leandroiber_mmastats"
MODEL_VERSION = "global-1.0.0"
VALIDATION_START = "2024-01-01"
ROWS_PER_INSERT = 100
MAX_SQL_FILE_BYTES = 900_000

FEATURES = ("global_skill", "resume_quality", "schedule_strength", "recent_form", "finishing_quality")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def slugify(value: Any) -> str:
    value = norm(value).replace(" ", "-").strip("-")
    return value[:120] or "fighter"


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


def first(d: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in d and d[name] not in (None, ""):
            return d[name]
    return None


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-min(value, 60))
        return 1 / (1 + z)
    z = math.exp(max(value, -60))
    return z / (1 + z)


def elo_expected(a: float, b: float) -> float:
    return 1 / (1 + 10 ** ((b - a) / 400))


def is_finish(method: Any) -> bool:
    text = norm(method)
    return any(x in text for x in ("ko", "tko", "submission", "sub ")) and "decision" not in text


def finish_type(method: Any) -> str | None:
    text = norm(method)
    if "submission" in text or text.startswith("sub"):
        return "SUB"
    if "ko" in text or "tko" in text:
        return "KO"
    if "decision" in text:
        return "DEC"
    return None


def method_text(row: dict[str, Any]) -> str:
    return str(first(row, "method_normalized", "method", "method_raw") or "")


def event_date(row: dict[str, Any]) -> str:
    return str(row.get("event_date") or "")[:10]


def winner_side(row: dict[str, Any]) -> int:
    return as_int(row.get("winner_side"), 0)


def quality_score(elo: float) -> float:
    # 1500 -> .50, 1700 -> .69, 1900 -> .83; bounded and promotion-agnostic.
    return sigmoid((elo - 1500) / 240)


def score_from_elo(value: float) -> float:
    return clamp(100 * sigmoid((value - 1500) / 260), 5, 97)


def score_from_form(value: float) -> float:
    return clamp(50 + value * 115, 5, 95)


def score_from_finish(value: float) -> float:
    # value is quality-weighted finishing production per decisive win opportunity.
    return clamp(20 + value * 85, 5, 95)


def weighted_recent(items: Iterable[tuple[float, float]]) -> float:
    num = den = 0.0
    for value, weight in items:
        num += value * weight
        den += weight
    return num / den if den else 0.0


@dataclass
class FighterState:
    elo: float = 1500.0
    bouts: int = 0
    decisive_bouts: int = 0
    wins: int = 0
    opponent_elos: list[tuple[float, str]] = field(default_factory=list)
    quality_wins: list[tuple[float, str, bool]] = field(default_factory=list)
    recent: deque = field(default_factory=lambda: deque(maxlen=8))

    def metrics(self) -> tuple[float, float, float, float, float]:
        skill = self.elo
        if self.quality_wins:
            top = sorted((elo for elo, _, _ in self.quality_wins), reverse=True)[:5]
            # Best wins carry the résumé, with a small breadth bonus capped at 80 Elo points.
            resume = sum(top) / len(top) + min(80.0, 18.0 * math.log1p(len(self.quality_wins)))
        else:
            resume = 1425.0
        if self.opponent_elos:
            recent_opps = self.opponent_elos[-10:]
            schedule = weighted_recent((elo, 1 / (1 + i * .12)) for i, (elo, _) in enumerate(reversed(recent_opps)))
        else:
            schedule = 1450.0
        if self.recent:
            form = weighted_recent((residual, 1 / (1 + i * .32)) for i, (_, residual, _, _) in enumerate(reversed(self.recent)))
        else:
            form = 0.0
        wins = max(1, self.wins)
        finish_value = sum(quality_score(opp) for opp, _, finish in self.quality_wins if finish) / (wins + 1.5)
        return skill, resume, schedule, form, finish_value

    def evidence(self) -> float:
        opponents = len({round(x[0], 1) for x in self.opponent_elos})
        bout_rel = 1 - math.exp(-self.bouts / 7)
        opp_rel = 1 - math.exp(-opponents / 7)
        return 100 * clamp(.72 * bout_rel + .28 * opp_rel, .08, .995)


@dataclass
class ValidationRow:
    fight_date: str
    x: tuple[float, ...]
    y: int
    elo_probability: float


class SqlChunkWriter:
    def __init__(self, directory: Path, prefix: int, stem: str):
        self.directory = directory
        self.prefix = prefix
        self.stem = stem
        self.part = 0
        self.lines: list[str] = []
        self.size = 0
        self.files: list[str] = []

    def add(self, statement: str) -> None:
        encoded = len(statement.encode())
        if self.lines and self.size + encoded > MAX_SQL_FILE_BYTES:
            self.flush()
        self.lines.append(statement if statement.endswith("\n") else statement + "\n")
        self.size += encoded + 1

    def flush(self) -> None:
        if not self.lines:
            return
        name = f"{self.prefix + self.part:04d}-{self.stem}.sql"
        (self.directory / name).write_text("BEGIN;\n" + "".join(self.lines) + "COMMIT;\n", encoding="utf-8")
        self.files.append(name)
        self.part += 1
        self.lines = []
        self.size = 0


def insert_batches(table: str, columns: list[str], rows: Iterable[list[Any]]) -> Iterable[str]:
    batch: list[list[Any]] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= ROWS_PER_INSERT:
            yield _insert(table, columns, batch)
            batch = []
    if batch:
        yield _insert(table, columns, batch)


def _insert(table: str, columns: list[str], rows: list[list[Any]]) -> str:
    values = ",\n".join("(" + ",".join(sql(v) for v in row) + ")" for row in rows)
    return f"INSERT OR REPLACE INTO {table} ({','.join(columns)}) VALUES\n{values};\n"


def table_dicts(con, table: str, order: str = "") -> list[dict[str, Any]]:
    cur = con.execute(f"SELECT * FROM {table} {order}")
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def promotion_registry(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    by_slug = {row["slug"]: row for row in rows}
    aliases: dict[str, str] = {}
    for row in rows:
        for alias in row.get("aliases", []):
            aliases[norm(alias)] = row["slug"]
    return by_slug, aliases


def promotion_for(org: Any, aliases: dict[str, str]) -> str | None:
    return aliases.get(norm(org))


def fit_positive_logistic(rows: list[ValidationRow], train_before: str) -> tuple[list[float], list[float]]:
    train = [r for r in rows if r.fight_date < train_before]
    if len(train) < 1000:
        raise RuntimeError(f"Not enough training fights before {train_before}: {len(train)}")
    dims = len(FEATURES)
    scales = []
    for j in range(dims):
        vals = [r.x[j] for r in train]
        scales.append(statistics.pstdev(vals) or 1.0)
    beta = [max(.03, scales[0] * math.log(10) / 400)] + [.08] * (dims - 1)
    # Projected gradient descent with light L2 regularization. Mirrored examples make intercept unnecessary.
    for step in range(700):
        grad = [0.0] * dims
        for r in train:
            z = [r.x[j] / scales[j] for j in range(dims)]
            p = sigmoid(sum(beta[j] * z[j] for j in range(dims)))
            err = p - r.y
            for j in range(dims):
                grad[j] += err * z[j]
        n = len(train)
        lr = .18 / math.sqrt(1 + step / 80)
        for j in range(dims):
            g = grad[j] / n + .012 * beta[j]
            beta[j] = max(0.0, beta[j] - lr * g)
    return beta, scales


def metrics(rows: list[ValidationRow], beta: list[float] | None = None, scales: list[float] | None = None) -> dict[str, float]:
    if not rows:
        return {"fights": 0, "log_loss": 0, "brier": 0, "accuracy": 0}
    loss = brier = correct = 0.0
    for r in rows:
        if beta is None:
            p = r.elo_probability
        else:
            z = [r.x[j] / scales[j] for j in range(len(beta))]
            p = sigmoid(sum(beta[j] * z[j] for j in range(len(beta))))
        p = clamp(p, 1e-6, 1 - 1e-6)
        loss += -(r.y * math.log(p) + (1 - r.y) * math.log(1 - p))
        brier += (p - r.y) ** 2
        correct += int((p >= .5) == bool(r.y))
    n = len(rows)
    return {"fights": n, "log_loss": loss / n, "brier": brier / n, "accuracy": correct / n}


def feature_weights(beta: list[float]) -> dict[str, float]:
    total = sum(beta)
    if total <= 1e-9:
        return {"global_skill": .60, "resume_quality": .16, "schedule_strength": .10, "recent_form": .10, "finishing_quality": .04}
    raw = {FEATURES[i]: beta[i] / total for i in range(len(FEATURES))}
    # Keep the graph skill component as the foundation even when correlated features are noisy.
    if raw["global_skill"] < .45:
        remainder = 1 - .45
        others = sum(raw[k] for k in FEATURES[1:]) or 1
        raw = {**raw, "global_skill": .45, **{k: raw[k] / others * remainder for k in FEATURES[1:]}}
    return raw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Path to dataset_global_v3.duckdb")
    parser.add_argument("--summary", default=".cache/mma-master/summary.json")
    parser.add_argument("--output", default=".cache/mma-master/sql")
    parser.add_argument("--promotions", default="scripts/data/scout-promotions.json")
    parser.add_argument("--validation-start", default=VALIDATION_START)
    args = parser.parse_args()

    import duckdb

    source = Path(args.source).resolve()
    summary_path = Path(args.summary)
    output = Path(args.output)
    registry, promotion_aliases = promotion_registry(Path(args.promotions))
    base_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    snapshot_id = base_summary["snapshot_id"]
    source_max_date = base_summary["source_max_date"]
    as_of = str(source_max_date)[:10]
    today = date.fromisoformat(as_of)

    con = duckdb.connect(str(source), read_only=True)
    fighters = table_dicts(con, "fighters_master", "ORDER BY fighter_id")
    fights = table_dicts(con, "fights_career_longitudinal", "ORDER BY event_date, fight_id")

    ids_by_name: dict[str, list[str]] = defaultdict(list)
    fighter_by_id: dict[str, dict[str, Any]] = {}
    for f in fighters:
        fid = str(f.get("fighter_id"))
        fighter_by_id[fid] = f
        ids_by_name[norm(f.get("fighter_name"))].append(fid)

    states: dict[str, FighterState] = defaultdict(FighterState)
    history: dict[str, list[dict[str, Any]]] = defaultdict(list)
    validation_rows: list[ValidationRow] = []
    unresolved = 0
    decisive = 0

    for row in fights:
        d = event_date(row)
        if not d or d > as_of:
            continue
        a_name = first(row, "fighter_1", "fighter1")
        b_name = first(row, "fighter_2", "fighter2")
        a_ids, b_ids = ids_by_name.get(norm(a_name), []), ids_by_name.get(norm(b_name), [])
        if len(a_ids) != 1 or len(b_ids) != 1 or a_ids[0] == b_ids[0]:
            unresolved += 1
            continue
        a, b = a_ids[0], b_ids[0]
        side = winner_side(row)
        a_state, b_state = states[a], states[b]
        a_pre, b_pre = a_state.metrics(), b_state.metrics()
        p_elo = elo_expected(a_state.elo, b_state.elo)
        if side in (1, 2):
            x = tuple(a_pre[j] - b_pre[j] for j in range(len(FEATURES)))
            y = 1 if side == 1 else 0
            validation_rows.append(ValidationRow(d, x, y, p_elo))
            validation_rows.append(ValidationRow(d, tuple(-v for v in x), 1 - y, 1 - p_elo))
            decisive += 1

        org = first(row, "organization") or "Unknown"
        wc = first(row, "weight_class")
        method = method_text(row)
        title = bool(first(row, "is_title_fight"))
        finish = is_finish(method)
        common = {"date": d, "organization": str(org), "weight_class": wc, "method": method, "title": title, "promotion_slug": promotion_for(org, promotion_aliases)}
        history[a].append({**common, "opponent_id": b, "opponent_name": str(b_name or ""), "result": "W" if side == 1 else "L" if side == 2 else "D", "finish_win": bool(side == 1 and finish), "opponent_pre_elo": b_state.elo})
        history[b].append({**common, "opponent_id": a, "opponent_name": str(a_name or ""), "result": "W" if side == 2 else "L" if side == 1 else "D", "finish_win": bool(side == 2 and finish), "opponent_pre_elo": a_state.elo})

        # Draws count as evidence/opposition but do not change Elo or quality-win state.
        for st, opp_elo in ((a_state, b_state.elo), (b_state, a_state.elo)):
            st.bouts += 1
            st.opponent_elos.append((opp_elo, d))

        if side in (1, 2):
            expected_a = p_elo
            result_a = 1 if side == 1 else 0
            result_b = 1 - result_a
            residual_a = result_a - expected_a
            residual_b = result_b - (1 - expected_a)
            a_state.decisive_bouts += 1
            b_state.decisive_bouts += 1
            a_state.recent.append((d, residual_a, b_state.elo, bool(side == 1 and finish)))
            b_state.recent.append((d, residual_b, a_state.elo, bool(side == 2 and finish)))
            if side == 1:
                a_state.wins += 1
                a_state.quality_wins.append((b_state.elo, d, finish))
            else:
                b_state.wins += 1
                b_state.quality_wins.append((a_state.elo, d, finish))
            k = 28 * (1.12 if finish else 1.0)
            delta = k * (result_a - expected_a)
            a_state.elo += delta
            b_state.elo -= delta

    beta, scales = fit_positive_logistic(validation_rows, args.validation_start)
    weights = feature_weights(beta)
    validation = [r for r in validation_rows if r.fight_date >= args.validation_start]
    combined_metrics = metrics(validation, beta, scales)
    elo_metrics = metrics(validation)

    # Build fighter scores first so ranks can be assigned before writing SQL.
    scored: dict[str, dict[str, Any]] = {}
    for fid, state in states.items():
        if not history.get(fid):
            continue
        skill_raw, resume_raw, schedule_raw, form_raw, finish_raw = state.metrics()
        components = {
            "global_skill": score_from_elo(skill_raw),
            "resume_quality": score_from_elo(resume_raw),
            "schedule_strength": score_from_elo(schedule_raw),
            "recent_form": score_from_form(form_raw),
            "finishing_quality": score_from_finish(finish_raw),
        }
        base = sum(weights[k] * components[k] for k in FEATURES)
        evidence = state.evidence()
        # Small-sample shrinkage is visible and moderate rather than a hidden prospect penalty.
        reliability = .30 + .70 * evidence / 100
        rating = clamp(50 + (base - 50) * reliability, 5, 97)
        latest = history[fid][-1]
        scored[fid] = {
            "rating": rating,
            "components": components,
            "evidence": evidence,
            "elo": state.elo,
            "weight_class": latest.get("weight_class") or "Unknown",
        }

    global_order = sorted(scored, key=lambda fid: scored[fid]["rating"], reverse=True)
    global_rank = {fid: i + 1 for i, fid in enumerate(global_order)}
    division_rank: dict[str, int] = {}
    by_div: dict[str, list[str]] = defaultdict(list)
    for fid, row in scored.items():
        by_div[row["weight_class"]].append(fid)
    for ids in by_div.values():
        ids.sort(key=lambda fid: scored[fid]["rating"], reverse=True)
        for i, fid in enumerate(ids):
            division_rank[fid] = i + 1

    profile_rows: list[list[Any]] = []
    rating_rows: list[list[Any]] = []
    promo_counts: dict[str, int] = defaultdict(int)
    slug_seen: dict[str, int] = defaultdict(int)

    for fid, f in fighter_by_id.items():
        rows = history.get(fid, [])
        if not rows:
            continue
        rows.sort(key=lambda x: x["date"])
        latest = rows[-1]
        record = {"W": 0, "L": 0, "D": 0, "NC": 0}
        kos = subs = decs = title_bouts = title_wins = 0
        organizations = set()
        recent_730 = recent_730_wins = 0
        for h in rows:
            result = h["result"] if h["result"] in record else "NC"
            record[result] += 1
            organizations.add(norm(h["organization"]))
            if h["title"]:
                title_bouts += 1
                title_wins += int(result == "W")
            if result == "W":
                ft = finish_type(h["method"])
                kos += int(ft == "KO")
                subs += int(ft == "SUB")
                decs += int(ft == "DEC")
            try:
                age_days = (today - date.fromisoformat(h["date"])).days
                if age_days <= 730:
                    recent_730 += 1
                    recent_730_wins += int(result == "W")
            except ValueError:
                pass
        last5 = rows[-5:]
        base_slug = slugify(f.get("fighter_name"))
        slug_seen[base_slug] += 1
        suffix = re.sub(r"[^a-zA-Z0-9]+", "", fid)[-8:].lower()
        profile_slug = base_slug if slug_seen[base_slug] == 1 and len(ids_by_name.get(norm(f.get("fighter_name")), [])) == 1 else f"{base_slug}-{suffix}"
        promo_slug = latest.get("promotion_slug")
        try:
            current = (today - date.fromisoformat(latest["date"])).days <= 730
        except ValueError:
            current = False
        if not current:
            promo_slug = None
        if promo_slug:
            promo_counts[promo_slug] += 1

        physical_fields = [f.get("dob"), f.get("height_cm"), f.get("reach_cm"), f.get("stance"), f.get("nationality"), f.get("gym")]
        completeness = 45 + 45 * sum(v not in (None, "") for v in physical_fields) / len(physical_fields) + min(10, len(rows))
        profile_rows.append([
            SOURCE_KEY, snapshot_id, fid, profile_slug, f.get("fighter_name"), norm(f.get("fighter_name")),
            f.get("dob"), f.get("height_cm"), f.get("reach_cm"), f.get("stance"), f.get("nationality"), f.get("gym"),
            rows[0]["date"], latest["date"], latest["organization"], promo_slug, latest.get("weight_class"),
            len(rows), record["W"], record["L"], record["D"], record["NC"], kos, subs, decs,
            title_bouts, title_wins, len(organizations), recent_730, recent_730_wins,
            sum(1 for x in last5 if x["result"] == "W"), sum(1 for x in last5 if x["result"] == "L"),
            clamp(completeness, 0, 100), utc_now()
        ])
        if fid in scored:
            s = scored[fid]
            evidence = {
                "career_bouts": len(rows),
                "unique_organizations": len(organizations),
                "best_wins": sorted([
                    {"opponent": x["opponent_name"], "date": x["date"], "opponent_pre_elo": round(x["opponent_pre_elo"], 1), "finish": x["finish_win"]}
                    for x in rows if x["result"] == "W"
                ], key=lambda x: x["opponent_pre_elo"], reverse=True)[:5],
                "recent": [{"date": x["date"], "opponent": x["opponent_name"], "result": x["result"], "organization": x["organization"]} for x in rows[-5:]],
            }
            c = s["components"]
            rating_rows.append([
                SOURCE_KEY, snapshot_id, fid, MODEL_VERSION, as_of, s["rating"], c["global_skill"], c["resume_quality"],
                c["schedule_strength"], c["recent_form"], c["finishing_quality"], s["evidence"], s["elo"],
                division_rank.get(fid), global_rank.get(fid), json.dumps(weights, separators=(",", ":")), json.dumps(evidence, separators=(",", ":"))
            ])

    profile_columns = [
        "source_key","snapshot_id","source_fighter_id","profile_slug","fighter_name","normalized_name","dob","height_cm","reach_cm","stance","nationality","gym",
        "career_start_date","last_fight_date","current_organization","current_promotion_slug","current_weight_class","career_bouts","career_wins","career_losses","career_draws","career_no_contests",
        "ko_tko_wins","submission_wins","decision_wins","title_fight_bouts","title_fight_wins","organization_count","recent_bouts_730d","recent_wins_730d","last_five_wins","last_five_losses","data_completeness","updated_at"
    ]
    rating_columns = [
        "source_key","snapshot_id","source_fighter_id","model_version","as_of_date","scout_rating","global_skill","resume_quality","schedule_strength","recent_form","finishing_quality","evidence_strength","pre_fight_elo","division_rank","global_rank","model_weights_json","evidence_json"
    ]
    profile_writer = SqlChunkWriter(output, 9000, "global-profiles")
    for stmt in insert_batches("scout_global_profiles", profile_columns, profile_rows):
        profile_writer.add(stmt)
    profile_writer.flush()
    rating_writer = SqlChunkWriter(output, 9500, "global-ratings")
    for stmt in insert_batches("scout_global_ratings", rating_columns, rating_rows):
        rating_writer.add(stmt)
    rating_writer.flush()

    model_meta = {
        "feature_order": FEATURES,
        "positive_logistic_beta": beta,
        "feature_scales": scales,
        "normalized_weights": weights,
        "elo_baseline": elo_metrics,
        "combined_model": combined_metrics,
    }
    model_sql = _insert("scout_rating_models", ["model_version","algorithm","trained_through","validation_start","validation_end","weights_json","validation_json","notes"], [[
        MODEL_VERSION,
        "chronological fight-graph Elo plus quality-win, schedule, form and finish components; positive logistic out-of-time weight fit",
        (date.fromisoformat(args.validation_start).replace(day=1)).isoformat(),
        args.validation_start,
        as_of,
        json.dumps(weights, separators=(",", ":")),
        json.dumps(model_meta, separators=(",", ":")),
        "Promotion labels are metadata only. No promotion prestige multiplier is used. Technical stats are optional enrichment, not a universal-rating input."
    ]])
    (output / "9800-global-rating-model.sql").write_text("BEGIN;\n" + model_sql + "COMMIT;\n", encoding="utf-8")

    audit = {
        "model_version": MODEL_VERSION,
        "snapshot_id": snapshot_id,
        "as_of_date": as_of,
        "profiles": len(profile_rows),
        "ratings": len(rating_rows),
        "decisive_fights": decisive,
        "unresolved_fight_rows": unresolved,
        "validation_start": args.validation_start,
        "weights": weights,
        "elo_baseline": elo_metrics,
        "combined_model": combined_metrics,
        "promotion_roster_counts": dict(sorted(promo_counts.items())),
        "promotion_registry_count": len(registry),
        "generated_files": profile_writer.files + rating_writer.files + ["9800-global-rating-model.sql"],
        "generated_at": utc_now(),
    }
    audit_path = summary_path.parent / "scout-global-summary.json"
    audit_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
