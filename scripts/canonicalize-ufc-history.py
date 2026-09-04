#!/usr/bin/env python3
"""Canonicalize the UFC-scoped warehouse history without mutating raw provenance.

The upstream career table contains mirrored/duplicate fight rows. CageMetrix keeps
that immutable source snapshot exactly as received, then canonicalizes only the
materialized UFC-linked history used by profile display, CMR priors and Predictor
features.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

DB = "cagemetrix"
ROWS_PER_INSERT = 25

HISTORY_COLUMNS = [
    "fighter_id", "source_key", "snapshot_id", "source_fight_id", "event_date", "organization", "event_name",
    "weight_class", "is_major_org", "method_raw", "method_normalized", "method_detail", "round_num",
    "time_finish_seconds", "result", "fighter_name", "normalized_name", "opponent_name", "opponent_normalized_name",
]

SUMMARY_COLUMNS = [
    "fighter_id", "first_ufc_date", "first_pre_ufc_fight_date", "last_pre_ufc_fight_date",
    "days_from_last_pre_ufc_to_debut", "pre_ufc_bouts", "pre_ufc_wins", "pre_ufc_losses", "pre_ufc_draws",
    "pre_ufc_no_contests", "pre_ufc_finishes", "pre_ufc_ko_tko_wins", "pre_ufc_submission_wins",
    "pre_ufc_decision_wins", "pre_ufc_major_org_bouts", "pre_ufc_distinct_opponents", "source_key", "snapshot_id", "updated_at",
]

FEATURE_COLUMNS = [
    "fighter_id", "ufc_source_key", "as_of_date", "pre_ufc_bouts", "pre_ufc_wins", "pre_ufc_losses", "pre_ufc_draws",
    "pre_ufc_no_contests", "pre_ufc_finishes", "pre_ufc_finish_rate", "pre_ufc_major_org_bouts",
    "pre_ufc_recent_bouts_730d", "pre_ufc_recent_wins_730d", "days_since_last_pre_ufc_fight",
    "prior_ufc_bouts", "prior_ufc_wins", "prior_ufc_losses", "prior_ufc_draws", "prior_ufc_finishes", "known_career_bouts",
    "source_key", "snapshot_id", "updated_at",
]


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


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


def insert_statements(table: str, columns: list[str], rows: Iterable[list[Any]]) -> Iterable[str]:
    batch: list[list[Any]] = []
    col_sql = ",".join(columns)
    for row in rows:
        batch.append(row)
        if len(batch) >= ROWS_PER_INSERT:
            values = ",\n".join("(" + ",".join(sql(v) for v in item) + ")" for item in batch)
            yield f"INSERT OR REPLACE INTO {table} ({col_sql}) VALUES\n{values};\n"
            batch = []
    if batch:
        values = ",\n".join("(" + ",".join(sql(v) for v in item) + ")" for item in batch)
        yield f"INSERT OR REPLACE INTO {table} ({col_sql}) VALUES\n{values};\n"


def write_sql_chunks(directory: Path, statements: Iterable[str], max_bytes: int = 800_000) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    for old in directory.glob("*.sql"):
        old.unlink()
    files: list[Path] = []
    parts: list[str] = []
    size = 0
    index = 1
    for statement in statements:
        encoded = len(statement.encode("utf-8"))
        if parts and size + encoded > max_bytes:
            path = directory / f"canonical-history-{index:03d}.sql"
            path.write_text("".join(parts), encoding="utf-8")
            files.append(path)
            index += 1
            parts, size = [], 0
        parts.append(statement)
        size += encoded
    if parts:
        path = directory / f"canonical-history-{index:03d}.sql"
        path.write_text("".join(parts), encoding="utf-8")
        files.append(path)
    return files


def execute_files(files: Iterable[Path], remote: bool) -> None:
    location = "--remote" if remote else "--local"
    for path in files:
        print(f"Applying {path.name}")
        wrangler(["d1", "execute", DB, location, "--file", str(path)])


def career_fight_key(row: dict[str, Any]) -> tuple[int, str, str, str]:
    """Stable derived identity for one fighter's view of one bout.

    Opponent is part of the key so same-night tournament bouts are retained.
    Event text is normalized so casing/punctuation differences do not defeat
    canonicalization. source_fight_id is intentionally excluded because upstream
    assigns different IDs to mirrored copies of the same fight.
    """
    return (
        as_int(row.get("fighter_id"), -1),
        str(row.get("event_date") or "")[:10],
        normalize_text(row.get("event_name")),
        normalize_text(row.get("opponent_normalized_name") or row.get("opponent_name")),
    )


def career_row_quality(row: dict[str, Any]) -> tuple[int, int, int, str]:
    known_result = int(str(row.get("result") or "") in {"W", "L", "D", "NC"})
    finish_time = int(row.get("time_finish_seconds") not in (None, ""))
    useful = sum(
        row.get(field) not in (None, "")
        for field in ("organization", "event_name", "weight_class", "method_raw", "method_normalized", "method_detail", "round_num")
    )
    # Lexical source ID is a deterministic final tie-breaker only.
    return known_result, finish_time, useful, str(row.get("source_fight_id") or "")


def dedupe_history_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, int]:
    canonical: dict[tuple[int, str, str, str], dict[str, Any]] = {}
    duplicates = 0
    conflicts = 0
    for row in rows:
        key = career_fight_key(row)
        previous = canonical.get(key)
        if previous is None:
            canonical[key] = row
            continue
        duplicates += 1
        if str(previous.get("result") or "") != str(row.get("result") or ""):
            conflicts += 1
        if career_row_quality(row) > career_row_quality(previous):
            canonical[key] = row
    output = sorted(
        canonical.values(),
        key=lambda item: (as_int(item.get("fighter_id"), -1), str(item.get("event_date") or ""), str(item.get("source_fight_id") or "")),
    )
    return output, duplicates, conflicts


def is_finish_win(row: dict[str, Any]) -> bool:
    if row.get("result") != "W":
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
    parser.add_argument("--output", default=".cache/mma-master/ufc-history-canonical-sql")
    args = parser.parse_args()

    raw_history = paged_query(
        "SELECT fighter_id,source_key,snapshot_id,source_fight_id,event_date,organization,event_name,weight_class,is_major_org,method_raw,method_normalized,method_detail,round_num,time_finish_seconds,result,fighter_name,normalized_name,opponent_name,opponent_normalized_name FROM ufc_warehouse_career_rows ORDER BY fighter_id,event_date,source_fight_id",
        args.remote,
    )
    native_fighters = paged_query("SELECT id FROM fighters ORDER BY id", args.remote)
    native_bouts = paged_query(
        "SELECT fighter_id,source_key,event_date,won,finish FROM bout_totals ORDER BY fighter_id,event_date,source_key",
        args.remote,
    )

    canonical, removed, conflicts = dedupe_history_rows(raw_history)
    history_by_fighter: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in canonical:
        history_by_fighter[as_int(row.get("fighter_id"), -1)].append(row)

    bouts_by_fighter: dict[int, list[dict[str, Any]]] = defaultdict(list)
    first_ufc_date: dict[int, str] = {}
    for bout in native_bouts:
        fighter_id = as_int(bout.get("fighter_id"), -1)
        event_date = str(bout.get("event_date") or "")[:10]
        if fighter_id < 0 or not event_date:
            continue
        clean = {**bout, "event_date": event_date}
        bouts_by_fighter[fighter_id].append(clean)
        if fighter_id not in first_ufc_date or event_date < first_ufc_date[fighter_id]:
            first_ufc_date[fighter_id] = event_date

    now = utc_now()
    history_rows = [[row.get(column) for column in HISTORY_COLUMNS] for row in canonical]

    summary_rows: list[list[Any]] = []
    for fighter in native_fighters:
        fighter_id = as_int(fighter.get("id"), -1)
        rows = history_by_fighter.get(fighter_id, [])
        first_pre = rows[0]["event_date"] if rows else None
        last_pre = rows[-1]["event_date"] if rows else None
        wins = sum(r.get("result") == "W" for r in rows)
        losses = sum(r.get("result") == "L" for r in rows)
        draws = sum(r.get("result") == "D" for r in rows)
        ncs = sum(r.get("result") == "NC" for r in rows)
        finishes = sum(is_finish_win(r) for r in rows)
        ko_tko = sum(
            r.get("result") == "W" and any(
                x in " ".join(str(r.get(k) or "") for k in ("method_normalized", "method_raw")).lower()
                for x in ("ko", "tko")
            )
            for r in rows
        )
        submissions = sum(
            r.get("result") == "W" and "sub" in " ".join(str(r.get(k) or "") for k in ("method_normalized", "method_raw")).lower()
            for r in rows
        )
        decisions = sum(
            r.get("result") == "W" and "decision" in " ".join(str(r.get(k) or "") for k in ("method_normalized", "method_raw")).lower()
            for r in rows
        )
        source_key = rows[0].get("source_key") if rows else None
        snapshot_id = rows[0].get("snapshot_id") if rows else None
        summary_rows.append([
            fighter_id,
            first_ufc_date.get(fighter_id),
            first_pre,
            last_pre,
            days_between(first_ufc_date.get(fighter_id), last_pre),
            len(rows), wins, losses, draws, ncs, finishes, ko_tko, submissions, decisions,
            sum(as_int(r.get("is_major_org")) == 1 for r in rows),
            len({normalize_text(r.get("opponent_normalized_name") or r.get("opponent_name")) for r in rows if r.get("opponent_name") or r.get("opponent_normalized_name")}),
            source_key,
            snapshot_id,
            now,
        ])

    feature_rows: list[list[Any]] = []
    for fighter_id, bouts in bouts_by_fighter.items():
        bouts.sort(key=lambda item: (item["event_date"], str(item.get("source_key") or "")))
        pre_rows = history_by_fighter.get(fighter_id, [])
        pre_wins = sum(r.get("result") == "W" for r in pre_rows)
        pre_losses = sum(r.get("result") == "L" for r in pre_rows)
        pre_draws = sum(r.get("result") == "D" for r in pre_rows)
        pre_ncs = sum(r.get("result") == "NC" for r in pre_rows)
        pre_finishes = sum(is_finish_win(r) for r in pre_rows)
        pre_major = sum(as_int(r.get("is_major_org")) == 1 for r in pre_rows)
        last_pre = pre_rows[-1]["event_date"] if pre_rows else None
        source_key = pre_rows[0].get("source_key") if pre_rows else None
        snapshot_id = pre_rows[0].get("snapshot_id") if pre_rows else None
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
                sum(r.get("result") == "W" for r in recent),
                days_between(as_of, last_pre),
                len(prior), prior_wins, prior_losses, prior_draws, prior_finishes,
                len(pre_rows) + len(prior),
                source_key,
                snapshot_id,
                now,
            ])
            prior.append(bout)

    statements: list[str] = [
        "DELETE FROM ufc_warehouse_career_rows;\n",
        "DELETE FROM ufc_fighter_history_summary;\n",
        "DELETE FROM ufc_prefight_history_features;\n",
    ]
    statements.extend(insert_statements("ufc_warehouse_career_rows", HISTORY_COLUMNS, history_rows))
    statements.extend(insert_statements("ufc_fighter_history_summary", SUMMARY_COLUMNS, summary_rows))
    statements.extend(insert_statements("ufc_prefight_history_features", FEATURE_COLUMNS, feature_rows))

    output = Path(args.output).resolve()
    files = write_sql_chunks(output, statements)
    execute_files(files, args.remote)

    affected_fighters = len({career_fight_key(row)[0] for row in raw_history}) - len({career_fight_key(row)[0] for row in canonical if False})
    duplicate_fighters = 0
    raw_counts: dict[int, int] = defaultdict(int)
    canonical_counts: dict[int, int] = defaultdict(int)
    for row in raw_history:
        raw_counts[as_int(row.get("fighter_id"), -1)] += 1
    for row in canonical:
        canonical_counts[as_int(row.get("fighter_id"), -1)] += 1
    duplicate_fighters = sum(raw_counts[fid] > canonical_counts.get(fid, 0) for fid in raw_counts)

    audit = {
        "raw_pre_ufc_candidate_rows": len(raw_history),
        "canonical_pre_ufc_rows": len(canonical),
        "duplicate_pre_ufc_rows_removed": removed,
        "fighters_with_duplicate_pre_ufc_rows": duplicate_fighters,
        "duplicate_result_conflicts": conflicts,
        "fighter_history_summaries": len(summary_rows),
        "prefight_history_feature_rows": len(feature_rows),
        "raw_source_mutated": False,
        "canonical_key": "fighter_id + event_date + normalized event_name + normalized opponent",
        "generated_at": now,
    }
    audit_path = output.parent / "ufc-history-canonical-summary.json"
    audit_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
