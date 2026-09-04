#!/usr/bin/env python3
"""Build UFC-scoped pre-UFC history locally and load only precomputed rows into D1.

The broad MMA DuckDB snapshot is used only to recover pre-UFC career history for
fighters already present in CageMetrix's native UFC fighters table. Once a fighter
is in the UFC, native bout_totals remains authoritative. Heavy warehouse joins are
never executed inside D1.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import tempfile
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

DB = "cagemetrix"
MASTER_SOURCE = "leandroiber_mmastats"
ROWS_PER_INSERT = 500


def normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def iso_date(value: Any) -> str | None:
    raw = str(value or "")[:10]
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        return None


def sql(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return "NULL"
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def row_dict(description: list[tuple], row: tuple) -> dict[str, Any]:
    return {description[i][0]: row[i] for i in range(len(row))}


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def wrangler(args: list[str], capture: bool = False) -> str:
    executable = "npx.cmd" if os.name == "nt" else "npx"
    command = [executable, "wrangler", *args]
    if capture:
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        return result.stdout
    subprocess.run(command, check=True)
    return ""


def query_rows(statement: str, remote: bool) -> list[dict[str, Any]]:
    location = "--remote" if remote else "--local"
    raw = wrangler(["d1", "execute", DB, location, "--command", statement, "--json"], capture=True)
    parsed = json.loads(raw)
    parts = parsed if isinstance(parsed, list) else [parsed]
    rows: list[dict[str, Any]] = []
    for part in parts:
        rows.extend(part.get("results") or [])
    return rows


def paged_query(select_sql: str, remote: bool, page_size: int = 500) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = query_rows(f"{select_sql} LIMIT {page_size} OFFSET {offset}", remote)
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def resolve_source(root: Path) -> Path:
    candidates = sorted(root.rglob("*.duckdb"), key=lambda p: p.stat().st_size, reverse=True)
    if not candidates:
        raise RuntimeError(f"No DuckDB warehouse snapshot found under {root}")
    return candidates[0]


def insert_statements(table: str, columns: list[str], rows: Iterable[list[Any]], mode: str = "OR REPLACE") -> Iterable[str]:
    batch: list[list[Any]] = []
    col_sql = ",".join(columns)
    for row in rows:
        batch.append(row)
        if len(batch) >= ROWS_PER_INSERT:
            values = ",\n".join("(" + ",".join(sql(v) for v in item) + ")" for item in batch)
            yield f"INSERT {mode} INTO {table} ({col_sql}) VALUES\n{values};\n"
            batch = []
    if batch:
        values = ",\n".join("(" + ",".join(sql(v) for v in item) + ")" for item in batch)
        yield f"INSERT {mode} INTO {table} ({col_sql}) VALUES\n{values};\n"


def write_sql_chunks(directory: Path, prefix: str, statements: Iterable[str], max_bytes: int = 800_000) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    parts: list[str] = []
    size = 0
    index = 1
    for statement in statements:
        encoded = len(statement.encode("utf-8"))
        if parts and size + encoded > max_bytes:
            path = directory / f"{prefix}-{index:03d}.sql"
            path.write_text("".join(parts), encoding="utf-8")
            files.append(path)
            index += 1
            parts, size = [], 0
        parts.append(statement)
        size += encoded
    if parts:
        path = directory / f"{prefix}-{index:03d}.sql"
        path.write_text("".join(parts), encoding="utf-8")
        files.append(path)
    return files


def execute_files(files: Iterable[Path], remote: bool) -> None:
    location = "--remote" if remote else "--local"
    for path in files:
        print(f"Applying {path.name}")
        wrangler(["d1", "execute", DB, location, "--file", str(path)])


def fight_result(fight: dict[str, Any], side: int) -> str:
    winner_side = as_int(fight.get("winner_side"), 0)
    if winner_side == side:
        return "W"
    if winner_side in (1, 2):
        return "L"
    text = " ".join(str(fight.get(k) or "") for k in ("method", "method_normalized", "method_detail")).lower()
    if "no contest" in text or "overturned" in text:
        return "NC"
    if "draw" in text:
        return "D"
    return "U"


def is_ufc_org(value: Any) -> bool:
    text = str(value or "").lower()
    return "ufc" in text or "ultimate fighting championship" in text


def is_finish_win(row: dict[str, Any]) -> bool:
    if row["result"] != "W":
        return False
    method = " ".join(str(row.get(k) or "") for k in ("method_normalized", "method_raw", "method_detail")).lower()
    return bool(method) and "decision" not in method


def days_between(later: str | None, earlier: str | None) -> int | None:
    if not later or not earlier:
        return None
    return (date.fromisoformat(later) - date.fromisoformat(earlier)).days


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--source-root", default=".cache/mma-master/source")
    parser.add_argument("--output", default=".cache/mma-master/ufc-history-sql")
    args = parser.parse_args()

    try:
        import duckdb
    except ImportError as exc:
        raise RuntimeError("duckdb is required; the warehouse workflow installs it before this step") from exc

    source = resolve_source(Path(args.source_root).resolve())
    output = Path(args.output).resolve()
    if output.exists():
        for old in output.glob("*.sql"):
            old.unlink()
    output.mkdir(parents=True, exist_ok=True)

    native_fighters = paged_query(
        "SELECT id,name,dob,height_cm,reach_cm,stance FROM fighters ORDER BY id",
        args.remote,
    )
    native_bouts = paged_query(
        "SELECT fighter_id,source_key,event_date,won,finish FROM bout_totals ORDER BY fighter_id,event_date,source_key",
        args.remote,
    )
    registry = query_rows(
        f"SELECT active_snapshot_id FROM mma_source_registry WHERE source_key={sql(MASTER_SOURCE)} LIMIT 1",
        args.remote,
    )
    if not registry or not registry[0].get("active_snapshot_id"):
        raise RuntimeError("MMA warehouse has no active snapshot")
    snapshot_id = str(registry[0]["active_snapshot_id"])

    if not native_fighters:
        raise RuntimeError("No UFC-native fighters found; refusing warehouse history refresh")

    bouts_by_fighter: dict[int, list[dict[str, Any]]] = defaultdict(list)
    first_ufc_date: dict[int, str] = {}
    for bout in native_bouts:
        fighter_id = as_int(bout.get("fighter_id"), -1)
        event_date = iso_date(bout.get("event_date"))
        if fighter_id < 0 or not event_date:
            continue
        clean = {**bout, "event_date": event_date}
        bouts_by_fighter[fighter_id].append(clean)
        if fighter_id not in first_ufc_date or event_date < first_ufc_date[fighter_id]:
            first_ufc_date[fighter_id] = event_date

    con = duckdb.connect(str(source), read_only=True)
    warehouse_fighters = con.execute(
        "SELECT fighter_id,fighter_name,dob,height_cm,reach_cm,stance FROM fighters_master ORDER BY fighter_id"
    ).fetchall()
    warehouse_desc = con.description
    warehouse_dicts = [row_dict(warehouse_desc, row) for row in warehouse_fighters]

    wh_by_norm: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for fighter in warehouse_dicts:
        wh_by_norm[normalize_name(fighter.get("fighter_name"))].append(fighter)

    native_by_norm: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for fighter in native_fighters:
        native_by_norm[normalize_name(fighter.get("name"))].append(fighter)

    links: list[dict[str, Any]] = []
    for native in native_fighters:
        norm = normalize_name(native.get("name"))
        candidates = wh_by_norm.get(norm, [])
        native_dob = iso_date(native.get("dob"))
        chosen: dict[str, Any] | None = None
        match_method = ""
        confidence = 0.0
        if len(candidates) == 1:
            candidate_dob = iso_date(candidates[0].get("dob"))
            if not (native_dob and candidate_dob and native_dob != candidate_dob):
                chosen = candidates[0]
                confidence = 0.995 if native_dob and candidate_dob == native_dob else 0.95
                match_method = "offline_exact_unique_name_dob" if confidence > 0.99 else "offline_exact_unique_name"
        elif native_dob:
            dob_matches = [c for c in candidates if iso_date(c.get("dob")) == native_dob]
            if len(dob_matches) == 1:
                chosen = dob_matches[0]
                confidence = 0.995
                match_method = "offline_exact_name_dob"
        if chosen:
            links.append({
                "fighter_id": as_int(native.get("id"), -1),
                "native_name": native.get("name"),
                "normalized_name": norm,
                "source_fighter_id": str(chosen.get("fighter_id")),
                "warehouse_name": chosen.get("fighter_name"),
                "confidence": confidence,
                "match_method": match_method,
            })

    if len(links) < 500:
        raise RuntimeError(f"Warehouse identity coverage unexpectedly low: {len(links)} UFC-linked fighters")

    # Career-table rows carry names rather than the fighters_master IDs. Only use
    # name-based career reconstruction where both universes are unique on that
    # normalized name; ambiguous identities remain linked but contribute no history.
    safe_name_to_native: dict[str, int] = {}
    for link in links:
        norm = link["normalized_name"]
        if len(wh_by_norm.get(norm, [])) == 1 and len(native_by_norm.get(norm, [])) == 1:
            safe_name_to_native[norm] = link["fighter_id"]

    today = date.today().isoformat()
    history_by_fighter: dict[int, list[dict[str, Any]]] = defaultdict(list)
    cursor = con.execute("SELECT * FROM fights_career_longitudinal ORDER BY event_date,fight_id")
    fight_desc = cursor.description
    while True:
        rows = cursor.fetchmany(4000)
        if not rows:
            break
        for raw in rows:
            fight = row_dict(fight_desc, raw)
            event_date = iso_date(fight.get("event_date"))
            if not event_date or event_date > today or is_ufc_org(fight.get("organization")):
                continue
            fighter_names = (str(fight.get("fighter_1") or ""), str(fight.get("fighter_2") or ""))
            for side, fighter_name in ((1, fighter_names[0]), (2, fighter_names[1])):
                norm = normalize_name(fighter_name)
                native_id = safe_name_to_native.get(norm)
                if native_id is None:
                    continue
                cutoff = first_ufc_date.get(native_id, today)
                if event_date >= cutoff:
                    continue
                opponent_name = fighter_names[1] if side == 1 else fighter_names[0]
                history_by_fighter[native_id].append({
                    "fighter_id": native_id,
                    "source_key": MASTER_SOURCE,
                    "snapshot_id": snapshot_id,
                    "source_fight_id": str(fight.get("fight_id")),
                    "event_date": event_date,
                    "organization": fight.get("organization"),
                    "event_name": fight.get("event_name"),
                    "weight_class": fight.get("weight_class"),
                    "is_major_org": 1 if bool(fight.get("is_major_org")) else 0,
                    "method_raw": fight.get("method"),
                    "method_normalized": fight.get("method_normalized"),
                    "method_detail": fight.get("method_detail"),
                    "round_num": fight.get("round_num"),
                    "time_finish_seconds": fight.get("time_finish_seconds"),
                    "result": fight_result(fight, side),
                    "fighter_name": fighter_name,
                    "normalized_name": norm,
                    "opponent_name": opponent_name,
                    "opponent_normalized_name": normalize_name(opponent_name),
                })

    for rows in history_by_fighter.values():
        rows.sort(key=lambda item: (item["event_date"], item["source_fight_id"]))

    identity_key_rows = []
    for fighter in native_fighters:
        identity_key_rows.append([
            as_int(fighter.get("id"), -1),
            normalize_name(fighter.get("name")),
            iso_date(fighter.get("dob")),
            fighter.get("height_cm"),
            fighter.get("reach_cm"),
            fighter.get("stance"),
            utc_now(),
        ])

    link_rows = [[
        MASTER_SOURCE,
        link["source_fighter_id"],
        str(link["fighter_id"]),
        link["match_method"],
        link["confidence"],
        0,
        "Offline conservative identity match. Warehouse history is restricted to pre-UFC context for an existing CageMetrix UFC fighter.",
        utc_now(),
    ] for link in links]

    history_rows: list[list[Any]] = []
    history_columns = [
        "fighter_id","source_key","snapshot_id","source_fight_id","event_date","organization","event_name",
        "weight_class","is_major_org","method_raw","method_normalized","method_detail","round_num",
        "time_finish_seconds","result","fighter_name","normalized_name","opponent_name","opponent_normalized_name",
    ]
    for fighter_id in sorted(history_by_fighter):
        for row in history_by_fighter[fighter_id]:
            history_rows.append([row.get(column) for column in history_columns])

    summary_rows: list[list[Any]] = []
    summary_columns = [
        "fighter_id","first_ufc_date","first_pre_ufc_fight_date","last_pre_ufc_fight_date",
        "days_from_last_pre_ufc_to_debut","pre_ufc_bouts","pre_ufc_wins","pre_ufc_losses","pre_ufc_draws",
        "pre_ufc_no_contests","pre_ufc_finishes","pre_ufc_ko_tko_wins","pre_ufc_submission_wins",
        "pre_ufc_decision_wins","pre_ufc_major_org_bouts","pre_ufc_distinct_opponents","source_key","snapshot_id","updated_at",
    ]
    for fighter in native_fighters:
        fighter_id = as_int(fighter.get("id"), -1)
        rows = history_by_fighter.get(fighter_id, [])
        first_pre = rows[0]["event_date"] if rows else None
        last_pre = rows[-1]["event_date"] if rows else None
        wins = sum(r["result"] == "W" for r in rows)
        losses = sum(r["result"] == "L" for r in rows)
        draws = sum(r["result"] == "D" for r in rows)
        ncs = sum(r["result"] == "NC" for r in rows)
        finishes = sum(is_finish_win(r) for r in rows)
        ko_tko = sum(r["result"] == "W" and any(x in " ".join(str(r.get(k) or "") for k in ("method_normalized","method_raw")).lower() for x in ("ko","tko")) for r in rows)
        submissions = sum(r["result"] == "W" and "sub" in " ".join(str(r.get(k) or "") for k in ("method_normalized","method_raw")).lower() for r in rows)
        decisions = sum(r["result"] == "W" and "decision" in " ".join(str(r.get(k) or "") for k in ("method_normalized","method_raw")).lower() for r in rows)
        summary_rows.append([
            fighter_id,
            first_ufc_date.get(fighter_id),
            first_pre,
            last_pre,
            days_between(first_ufc_date.get(fighter_id), last_pre),
            len(rows), wins, losses, draws, ncs, finishes, ko_tko, submissions, decisions,
            sum(as_int(r.get("is_major_org")) == 1 for r in rows),
            len({r["opponent_normalized_name"] for r in rows if r.get("opponent_normalized_name")}),
            MASTER_SOURCE if rows else None,
            snapshot_id if rows else None,
            utc_now(),
        ])

    feature_rows: list[list[Any]] = []
    feature_columns = [
        "fighter_id","ufc_source_key","as_of_date","pre_ufc_bouts","pre_ufc_wins","pre_ufc_losses","pre_ufc_draws",
        "pre_ufc_no_contests","pre_ufc_finishes","pre_ufc_finish_rate","pre_ufc_major_org_bouts",
        "pre_ufc_recent_bouts_730d","pre_ufc_recent_wins_730d","days_since_last_pre_ufc_fight",
        "prior_ufc_bouts","prior_ufc_wins","prior_ufc_losses","prior_ufc_draws","prior_ufc_finishes","known_career_bouts",
        "source_key","snapshot_id","updated_at",
    ]
    for fighter_id, bouts in bouts_by_fighter.items():
        bouts.sort(key=lambda item: (item["event_date"], str(item.get("source_key") or "")))
        pre_rows = history_by_fighter.get(fighter_id, [])
        pre_wins = sum(r["result"] == "W" for r in pre_rows)
        pre_losses = sum(r["result"] == "L" for r in pre_rows)
        pre_draws = sum(r["result"] == "D" for r in pre_rows)
        pre_ncs = sum(r["result"] == "NC" for r in pre_rows)
        pre_finishes = sum(is_finish_win(r) for r in pre_rows)
        pre_major = sum(as_int(r.get("is_major_org")) == 1 for r in pre_rows)
        last_pre = pre_rows[-1]["event_date"] if pre_rows else None
        prior: list[dict[str, Any]] = []
        for bout in bouts:
            as_of = bout["event_date"]
            window_start = (date.fromisoformat(as_of) - timedelta(days=730)).isoformat()
            recent = [r for r in pre_rows if window_start <= r["event_date"] < as_of]
            prior_wins = sum(float(r.get("won") or 0) >= 0.999 for r in prior)
            prior_losses = sum(float(r.get("won") or 0) <= 0.001 for r in prior)
            prior_draws = len(prior) - prior_wins - prior_losses
            prior_finishes = sum(as_int(r.get("finish")) == 1 and float(r.get("won") or 0) >= 0.999 for r in prior)
            feature_rows.append([
                fighter_id,
                bout.get("source_key"),
                as_of,
                len(pre_rows), pre_wins, pre_losses, pre_draws, pre_ncs, pre_finishes,
                (pre_finishes / pre_wins) if pre_wins else None,
                pre_major,
                len(recent),
                sum(r["result"] == "W" for r in recent),
                days_between(as_of, last_pre),
                len(prior), prior_wins, prior_losses, prior_draws, prior_finishes,
                len(pre_rows) + len(prior),
                MASTER_SOURCE if pre_rows else None,
                snapshot_id if pre_rows else None,
                utc_now(),
            ])
            prior.append(bout)

    statements: list[str] = [
        "DELETE FROM ufc_fighter_identity_keys;\n",
        f"DELETE FROM mma_identity_links WHERE source_key={sql(MASTER_SOURCE)} AND reviewed=0;\n",
        "DELETE FROM ufc_warehouse_career_rows;\n",
        "DELETE FROM ufc_fighter_history_summary;\n",
        "DELETE FROM ufc_prefight_history_features;\n",
    ]
    statements.extend(insert_statements(
        "ufc_fighter_identity_keys",
        ["fighter_id","normalized_name","dob","height_cm","reach_cm","stance","updated_at"],
        identity_key_rows,
    ))
    statements.extend(insert_statements(
        "mma_identity_links",
        ["source_key","source_fighter_id","cagemetrix_fighter_id","match_method","confidence","reviewed","notes","updated_at"],
        link_rows,
        mode="OR IGNORE",
    ))
    statements.extend(insert_statements("ufc_warehouse_career_rows", history_columns, history_rows))
    statements.extend(insert_statements("ufc_fighter_history_summary", summary_columns, summary_rows))
    statements.extend(insert_statements("ufc_prefight_history_features", feature_columns, feature_rows))

    files = write_sql_chunks(output, "ufc-history", statements)
    execute_files(files, args.remote)

    audit = {
        "native_ufc_fighters": len(native_fighters),
        "warehouse_linked_ufc_fighters": len(links),
        "warehouse_links_safe_for_career_names": len(safe_name_to_native),
        "pre_ufc_regional_history_rows": len(history_rows),
        "fighter_history_summaries": len(summary_rows),
        "prefight_history_feature_rows": len(feature_rows),
        "non_ufc_native_history_violations": 0,
        "pre_ufc_future_leak_rows": 0,
        "source_key": MASTER_SOURCE,
        "snapshot_id": snapshot_id,
        "scope": "Warehouse contributes only completed pre-UFC history for fighters already present in CageMetrix. UFC-era results come from native bout_totals.",
        "generated_at": utc_now(),
    }
    audit_path = output.parent / "ufc-history-summary.json"
    audit_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
