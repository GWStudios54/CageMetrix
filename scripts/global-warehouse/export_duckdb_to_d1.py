#!/usr/bin/env python3
"""Convert the external MMA Global DuckDB snapshot into D1-compatible SQL.

The warehouse is intentionally research-only. It never creates CageMetrix
historical predictions or mutates the production ratings/prediction tables.
Source-native identities are preserved even when cross-table links are unclear.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import unicodedata
from collections import defaultdict

import duckdb

SOURCE_KEY = "leandroiber_mma_global_v3"
SOURCE_NAME = "MMA Global Database v3"
SOURCE_URL = "https://www.kaggle.com/datasets/leandroiber/mmastats"
UPSTREAM = [
    "Sherdog Fight Finder",
    "UFCStats.com",
    "Wikipedia UFC champions lists",
    "statleaders.ufc.com",
]
MAX_STATEMENT_BYTES = 90_000
SUFFIX_TOKENS = {"jr", "junior", "sr", "senior", "ii", "iii", "iv"}


def normalize_name(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def surname_token(value: object) -> str:
    tokens = normalize_name(value).split()
    while tokens and tokens[-1] in SUFFIX_TOKENS:
        tokens.pop()
    return tokens[-1] if tokens else ""


def date_string(value: object) -> str:
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()[:10]
    return str(value or "")[:10]


def date_value(value: object) -> dt.date | None:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(date_string(value))
    except ValueError:
        return None


def unordered_pair(a: str, b: str) -> tuple[str, str]:
    return tuple(sorted((a, b)))


def exact_pair_key(event_date: object, fighter_1: object, fighter_2: object) -> tuple[str, str, str]:
    first, second = unordered_pair(normalize_name(fighter_1), normalize_name(fighter_2))
    return (date_string(event_date), first, second)


def surname_pair_key(fighter_1: object, fighter_2: object) -> tuple[str, str]:
    return unordered_pair(surname_token(fighter_1), surname_token(fighter_2))


def canonical_source_signature(organization: object, event_date: object, fighter_1: object, fighter_2: object) -> tuple[str, str, str, str]:
    first, second = unordered_pair(normalize_name(fighter_1), normalize_name(fighter_2))
    return (str(organization or "unknown").lower(), date_string(event_date), first, second)


def sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (dt.date, dt.datetime)):
        return "'" + value.isoformat().replace("'", "''") + "'"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return "NULL" if not math.isfinite(value) else repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def as_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def as_bool_int(value: object) -> int:
    return 1 if bool(value) else 0


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class SqlWriter:
    def __init__(self, path: pathlib.Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = path.open("w", encoding="utf-8", newline="\n")
        self.statements = 0
        self.rows = 0

    def raw(self, statement: str) -> None:
        statement = statement.strip()
        if len(statement.encode("utf-8")) > 99_000:
            raise ValueError("Generated SQL statement exceeds D1's 100 KB statement limit")
        self.handle.write(statement)
        if not statement.endswith(";"):
            self.handle.write(";")
        self.handle.write("\n")
        self.statements += 1

    def insert_rows(
        self,
        table: str,
        columns: list[str],
        rows,
        conflict_columns: list[str],
        update_columns: list[str],
    ) -> int:
        prefix = f"INSERT INTO {table}({','.join(columns)}) VALUES\n"
        conflict = (
            f"\nON CONFLICT({','.join(conflict_columns)}) DO UPDATE SET "
            + ",".join(f"{column}=excluded.{column}" for column in update_columns)
            + ";"
        )
        current: list[str] = []
        current_bytes = len(prefix.encode()) + len(conflict.encode())
        count = 0

        def flush() -> None:
            nonlocal current, current_bytes
            if not current:
                return
            self.raw(prefix + ",\n".join(current) + conflict)
            current = []
            current_bytes = len(prefix.encode()) + len(conflict.encode())

        for row in rows:
            values = "(" + ",".join(sql_literal(row.get(column)) for column in columns) + ")"
            value_bytes = len(values.encode("utf-8")) + 2
            if current and current_bytes + value_bytes > MAX_STATEMENT_BYTES:
                flush()
            if len(prefix.encode()) + len(conflict.encode()) + value_bytes > MAX_STATEMENT_BYTES:
                raise ValueError(f"A single {table} row is too large for the D1 import statement")
            current.append(values)
            current_bytes += value_bytes
            count += 1
        flush()
        self.rows += count
        return count

    def close(self) -> None:
        self.handle.close()


def table_columns(connection: duckdb.DuckDBPyConnection, table: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info('{table}')").fetchall()]


def require_schema(connection: duckdb.DuckDBPyConnection) -> None:
    tables = {row[0] for row in connection.execute("SHOW TABLES").fetchall()}
    required = {"fighters_master", "fights_career_longitudinal", "fights_master_typed"}
    missing = required - tables
    if missing:
        raise RuntimeError(f"Source snapshot is missing required tables: {sorted(missing)}")
    required_columns = {
        "fighters_master": {"fighter_id", "fighter_name"},
        "fights_career_longitudinal": {
            "fight_id", "organization", "event_name", "event_date", "fighter_1", "fighter_2",
            "winner", "winner_side", "method", "method_normalized", "round_num", "time_finish_seconds",
        },
        "fights_master_typed": {
            "fight_id", "organization", "event_name", "event_date", "fighter_1", "fighter_2", "has_stats",
            "f1_sig_str_landed", "f1_sig_str_attempted", "f1_td_landed", "f1_td_attempted",
            "f2_sig_str_landed", "f2_sig_str_attempted", "f2_td_landed", "f2_td_attempted",
        },
    }
    for table, expected in required_columns.items():
        missing_columns = expected - set(table_columns(connection, table))
        if missing_columns:
            raise RuntimeError(f"{table} is missing expected columns: {sorted(missing_columns)}")


def outcome_for(row: dict) -> str:
    side = as_int(row.get("winner_side"))
    if side == 1:
        return "fighter_1"
    if side == 2:
        return "fighter_2"
    winner = normalize_name(row.get("winner"))
    f1 = normalize_name(row.get("fighter_1"))
    f2 = normalize_name(row.get("fighter_2"))
    if winner and winner == f1:
        return "fighter_1"
    if winner and winner == f2:
        return "fighter_2"
    method = " ".join(str(row.get(key) or "") for key in ("method", "method_normalized", "method_detail")).lower()
    if "draw" in method or "empate" in method:
        return "draw"
    if "no contest" in method or re.search(r"\bnc\b", method) or "overturned" in method:
        return "no_contest"
    return "unknown"


def rows_as_dicts(cursor, batch_size: int = 4000):
    columns = [item[0] for item in cursor.description]
    while True:
        batch = cursor.fetchmany(batch_size)
        if not batch:
            break
        for values in batch:
            yield dict(zip(columns, values))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--report", required=True, type=pathlib.Path)
    parser.add_argument("--min-bouts", type=int, default=100_000)
    parser.add_argument("--min-fighters", type=int, default=10_000)
    parser.add_argument("--min-organizations", type=int, default=100)
    args = parser.parse_args()

    source_hash = sha256_file(args.db)
    source_version = source_hash[:20]
    run_id = f"{SOURCE_KEY}:{source_version}"
    imported_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    connection = duckdb.connect(str(args.db), read_only=True)
    require_schema(connection)

    counts = {
        table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in ("fighters_master", "fights_career_longitudinal", "fights_master_typed")
    }
    detailed_with_stats_source = connection.execute(
        "SELECT COUNT(*) FROM fights_master_typed WHERE has_stats"
    ).fetchone()[0]
    duplicate_bout_ids = connection.execute(
        "SELECT COUNT(*) FROM (SELECT fight_id FROM fights_career_longitudinal GROUP BY fight_id HAVING COUNT(*) > 1)"
    ).fetchone()[0]
    organizations = connection.execute("SELECT COUNT(DISTINCT organization) FROM fights_career_longitudinal").fetchone()[0]
    first_date, last_date = connection.execute(
        "SELECT CAST(MIN(event_date) AS VARCHAR), CAST(MAX(event_date) AS VARCHAR) FROM fights_career_longitudinal"
    ).fetchone()

    if counts["fights_career_longitudinal"] < args.min_bouts:
        raise RuntimeError(f"Source regression: only {counts['fights_career_longitudinal']} global bouts")
    if counts["fighters_master"] < args.min_fighters:
        raise RuntimeError(f"Source regression: only {counts['fighters_master']} fighters")
    if organizations < args.min_organizations:
        raise RuntimeError(f"Source regression: only {organizations} organizations")
    if duplicate_bout_ids:
        raise RuntimeError(f"Source has {duplicate_bout_ids} duplicate fight IDs")

    fighter_rows = connection.execute("SELECT * FROM fighters_master").fetchall()
    fighter_columns = [item[0] for item in connection.description]
    source_fighters = [dict(zip(fighter_columns, values)) for values in fighter_rows]
    by_normalized: dict[str, list[str]] = defaultdict(list)
    for fighter in source_fighters:
        by_normalized[normalize_name(fighter["fighter_name"])].append(str(fighter["fighter_id"]))

    def unique_source_id(name: object) -> str | None:
        matches = by_normalized.get(normalize_name(name), [])
        return matches[0] if len(matches) == 1 else None

    writer = SqlWriter(args.output)
    upstream_json = json.dumps(UPSTREAM, separators=(",", ":"))
    usage_note = (
        "Internal research warehouse. Preserve source provenance; validate important records against primary sources "
        "before public display. Imported history is never represented as a historical CageMetrix prediction."
    )
    writer.raw(
        "INSERT INTO warehouse_sources(source_key,display_name,source_url,upstream_sources_json,usage_note) VALUES("
        + ",".join(sql_literal(v) for v in (SOURCE_KEY, SOURCE_NAME, SOURCE_URL, upstream_json, usage_note))
        + ") ON CONFLICT(source_key) DO UPDATE SET display_name=excluded.display_name,source_url=excluded.source_url,"
          "upstream_sources_json=excluded.upstream_sources_json,usage_note=excluded.usage_note;"
    )
    writer.raw(
        "INSERT INTO warehouse_ingestion_runs(run_id,source_key,source_hash,source_version,started_at) VALUES("
        + ",".join(sql_literal(v) for v in (run_id, SOURCE_KEY, source_hash, source_version, imported_at))
        + ") ON CONFLICT(run_id) DO UPDATE SET started_at=excluded.started_at,completed_at=NULL;"
    )

    fighter_output_columns = [
        "source_key", "source_fighter_id", "fighter_name", "normalized_name", "dob", "height_cm", "reach_cm",
        "stance", "nationality", "gym", "source_version", "last_seen_run_id", "imported_at",
    ]
    fighter_output = (
        {
            "source_key": SOURCE_KEY,
            "source_fighter_id": str(row["fighter_id"]),
            "fighter_name": row["fighter_name"],
            "normalized_name": normalize_name(row["fighter_name"]),
            "dob": row.get("dob"),
            "height_cm": row.get("height_cm"),
            "reach_cm": row.get("reach_cm"),
            "stance": row.get("stance"),
            "nationality": row.get("nationality"),
            "gym": row.get("gym"),
            "source_version": source_version,
            "last_seen_run_id": run_id,
            "imported_at": imported_at,
        }
        for row in source_fighters
    )
    fighter_count = writer.insert_rows(
        "warehouse_fighters", fighter_output_columns, fighter_output,
        ["source_key", "source_fighter_id"],
        [column for column in fighter_output_columns if column not in {"source_key", "source_fighter_id"}],
    )

    bout_columns = [
        "source_key", "source_bout_id", "organization", "event_name", "event_date", "event_year", "event_location",
        "weight_class", "fighter_1_name", "fighter_2_name", "fighter_1_normalized", "fighter_2_normalized",
        "fighter_1_source_id", "fighter_2_source_id", "winner_name", "winner_side", "outcome", "is_title_fight",
        "method_raw", "method_normalized", "method_detail", "finish_round", "finish_time_seconds",
        "fighter_1_height_cm", "fighter_1_weight_kg", "fighter_2_height_cm", "fighter_2_weight_kg", "referee",
        "fighter_1_gym", "fighter_2_gym", "fighter_1_nationality", "fighter_2_nationality", "is_major_org",
        "source_version", "last_seen_run_id", "imported_at",
    ]
    participant_instances = 0
    participant_links = 0
    ambiguous_names: set[str] = set()
    bout_ids: set[str] = set()
    exact_ufc_matches: dict[tuple[str, str, str], str | None] = {}
    surname_ufc_matches: dict[tuple[str, str], list[tuple[dt.date, str]]] = defaultdict(list)
    source_signatures: dict[tuple[str, str, str, str], int] = defaultdict(int)

    def bout_output():
        nonlocal participant_instances, participant_links
        cursor = connection.execute("SELECT * FROM fights_career_longitudinal ORDER BY event_date, fight_id")
        for row in rows_as_dicts(cursor):
            source_bout_id = str(row["fight_id"])
            organization = str(row.get("organization") or "unknown").lower()
            f1_normalized = normalize_name(row["fighter_1"])
            f2_normalized = normalize_name(row["fighter_2"])
            bout_ids.add(source_bout_id)
            source_signatures[canonical_source_signature(organization, row["event_date"], row["fighter_1"], row["fighter_2"])] += 1

            if organization == "ufc":
                exact_key = exact_pair_key(row["event_date"], row["fighter_1"], row["fighter_2"])
                if exact_key in exact_ufc_matches:
                    exact_ufc_matches[exact_key] = None
                else:
                    exact_ufc_matches[exact_key] = source_bout_id
                bout_date = date_value(row["event_date"])
                surname_key = surname_pair_key(row["fighter_1"], row["fighter_2"])
                if bout_date and all(surname_key):
                    surname_ufc_matches[surname_key].append((bout_date, source_bout_id))

            f1_id = unique_source_id(row["fighter_1"])
            f2_id = unique_source_id(row["fighter_2"])
            participant_instances += 2
            participant_links += int(f1_id is not None) + int(f2_id is not None)
            for name, sid in ((row["fighter_1"], f1_id), (row["fighter_2"], f2_id)):
                norm = normalize_name(name)
                if sid is None and len(by_normalized.get(norm, [])) > 1:
                    ambiguous_names.add(str(name))
            yield {
                "source_key": SOURCE_KEY,
                "source_bout_id": source_bout_id,
                "organization": organization,
                "event_name": row["event_name"],
                "event_date": row["event_date"],
                "event_year": as_int(row.get("event_year")),
                "event_location": row.get("event_location"),
                "weight_class": row.get("weight_class"),
                "fighter_1_name": row["fighter_1"],
                "fighter_2_name": row["fighter_2"],
                "fighter_1_normalized": f1_normalized,
                "fighter_2_normalized": f2_normalized,
                "fighter_1_source_id": f1_id,
                "fighter_2_source_id": f2_id,
                "winner_name": row.get("winner"),
                "winner_side": as_int(row.get("winner_side")),
                "outcome": outcome_for(row),
                "is_title_fight": as_bool_int(row.get("is_title_fight")),
                "method_raw": row.get("method"),
                "method_normalized": row.get("method_normalized"),
                "method_detail": row.get("method_detail"),
                "finish_round": as_int(row.get("round_num")),
                "finish_time_seconds": as_int(row.get("time_finish_seconds")),
                "fighter_1_height_cm": row.get("f1_height_cm"),
                "fighter_1_weight_kg": row.get("f1_weight_kg"),
                "fighter_2_height_cm": row.get("f2_height_cm"),
                "fighter_2_weight_kg": row.get("f2_weight_kg"),
                "referee": row.get("referee"),
                "fighter_1_gym": row.get("f1_gym"),
                "fighter_2_gym": row.get("f2_gym"),
                "fighter_1_nationality": row.get("f1_nationality"),
                "fighter_2_nationality": row.get("f2_nationality"),
                "is_major_org": as_bool_int(row.get("is_major_org")),
                "source_version": source_version,
                "last_seen_run_id": run_id,
                "imported_at": imported_at,
            }

    bout_count = writer.insert_rows(
        "warehouse_bouts", bout_columns, bout_output(), ["source_key", "source_bout_id"],
        [column for column in bout_columns if column not in {"source_key", "source_bout_id"}],
    )

    duplicate_signature_groups = sum(1 for count in source_signatures.values() if count > 1)
    duplicate_signature_rows = sum(count for count in source_signatures.values() if count > 1)

    stat_columns = [
        "source_key", "source_detail_bout_id", "matched_global_bout_id", "match_method", "match_confidence",
        "organization", "event_name", "event_date", "fighter_1_name", "fighter_2_name", "fighter_1_source_id",
        "fighter_2_source_id", "fighter_1_reach_cm", "fighter_2_reach_cm", "fighter_1_stance", "fighter_2_stance",
        "fighter_1_dob", "fighter_2_dob", "fighter_1_kd", "fighter_2_kd", "fighter_1_sig_landed",
        "fighter_1_sig_attempted", "fighter_2_sig_landed", "fighter_2_sig_attempted", "fighter_1_td_landed",
        "fighter_1_td_attempted", "fighter_2_td_landed", "fighter_2_td_attempted", "fighter_1_ctrl_seconds",
        "fighter_2_ctrl_seconds", "has_stats", "is_no_contest", "source_version", "last_seen_run_id", "imported_at",
    ]
    detail_match_counts = defaultdict(int)

    def match_detail(row: dict) -> tuple[str | None, str, float]:
        typed_bout_id = str(row["fight_id"])
        if typed_bout_id in bout_ids:
            return typed_bout_id, "source_id", 1.0

        exact = exact_ufc_matches.get(exact_pair_key(row["event_date"], row["fighter_1"], row["fighter_2"]))
        if exact:
            return exact, "exact_date_pair", 0.99

        detailed_date = date_value(row["event_date"])
        surname_key = surname_pair_key(row["fighter_1"], row["fighter_2"])
        if detailed_date and all(surname_key):
            candidates = {
                bout_id
                for candidate_date, bout_id in surname_ufc_matches.get(surname_key, [])
                if abs((candidate_date - detailed_date).days) <= 2
            }
            if len(candidates) == 1:
                return next(iter(candidates)), "date_window_surnames", 0.90

        return None, "unresolved", 0.0

    def stat_output():
        cursor = connection.execute("SELECT * FROM fights_master_typed ORDER BY event_date, fight_id")
        for row in rows_as_dicts(cursor):
            matched_bout_id, match_method, match_confidence = match_detail(row)
            detail_match_counts[match_method] += 1
            yield {
                "source_key": SOURCE_KEY,
                "source_detail_bout_id": str(row["fight_id"]),
                "matched_global_bout_id": matched_bout_id,
                "match_method": match_method,
                "match_confidence": match_confidence,
                "organization": str(row.get("organization") or "unknown").lower(),
                "event_name": row.get("event_name"),
                "event_date": row["event_date"],
                "fighter_1_name": row["fighter_1"],
                "fighter_2_name": row["fighter_2"],
                "fighter_1_source_id": unique_source_id(row["fighter_1"]),
                "fighter_2_source_id": unique_source_id(row["fighter_2"]),
                "fighter_1_reach_cm": row.get("f1_reach_cm"),
                "fighter_2_reach_cm": row.get("f2_reach_cm"),
                "fighter_1_stance": row.get("f1_stance"),
                "fighter_2_stance": row.get("f2_stance"),
                "fighter_1_dob": row.get("f1_dob"),
                "fighter_2_dob": row.get("f2_dob"),
                "fighter_1_kd": as_int(row.get("f1_kd")),
                "fighter_2_kd": as_int(row.get("f2_kd")),
                "fighter_1_sig_landed": as_int(row.get("f1_sig_str_landed")),
                "fighter_1_sig_attempted": as_int(row.get("f1_sig_str_attempted")),
                "fighter_2_sig_landed": as_int(row.get("f2_sig_str_landed")),
                "fighter_2_sig_attempted": as_int(row.get("f2_sig_str_attempted")),
                "fighter_1_td_landed": as_int(row.get("f1_td_landed")),
                "fighter_1_td_attempted": as_int(row.get("f1_td_attempted")),
                "fighter_2_td_landed": as_int(row.get("f2_td_landed")),
                "fighter_2_td_attempted": as_int(row.get("f2_td_attempted")),
                "fighter_1_ctrl_seconds": as_int(row.get("f1_ctrl_seconds")),
                "fighter_2_ctrl_seconds": as_int(row.get("f2_ctrl_seconds")),
                "has_stats": as_bool_int(row.get("has_stats")),
                "is_no_contest": as_bool_int(row.get("is_no_contest")),
                "source_version": source_version,
                "last_seen_run_id": run_id,
                "imported_at": imported_at,
            }

    detailed_count = writer.insert_rows(
        "warehouse_bout_stats", stat_columns, stat_output(), ["source_key", "source_detail_bout_id"],
        [column for column in stat_columns if column not in {"source_key", "source_detail_bout_id"}],
    )

    unknown_outcomes = connection.execute(
        "SELECT COUNT(*) FROM fights_career_longitudinal WHERE winner_side IS NULL AND winner IS NULL"
    ).fetchone()[0]
    link_rate = participant_links / participant_instances if participant_instances else 0.0
    report = {
        "source_key": SOURCE_KEY,
        "source_url": SOURCE_URL,
        "source_sha256": source_hash,
        "source_version": source_version,
        "run_id": run_id,
        "generated_at": imported_at,
        "fighters": fighter_count,
        "bouts": bout_count,
        "detailed_bouts_imported": detailed_count,
        "detailed_bouts_source": counts["fights_master_typed"],
        "detailed_rows_with_stats_source": detailed_with_stats_source,
        "detailed_match_counts": dict(detail_match_counts),
        "organizations": organizations,
        "first_event_date": first_date,
        "last_event_date": last_date,
        "duplicate_bout_ids": duplicate_bout_ids,
        "duplicate_canonical_signature_groups": duplicate_signature_groups,
        "duplicate_canonical_signature_rows": duplicate_signature_rows,
        "participant_identity_link_rate": link_rate,
        "participant_instances": participant_instances,
        "participant_source_ids_resolved": participant_links,
        "ambiguous_normalized_fighter_names": sorted(ambiguous_names),
        "source_null_winner_and_side_rows": unknown_outcomes,
        "sql_statements": writer.statements,
    }
    report_json = json.dumps(report, separators=(",", ":"), ensure_ascii=False)
    writer.raw(
        "UPDATE warehouse_ingestion_runs SET completed_at=" + sql_literal(imported_at)
        + ",fighter_rows=" + str(fighter_count)
        + ",bout_rows=" + str(bout_count)
        + ",detailed_bout_rows=" + str(detailed_count)
        + ",organization_rows=" + str(organizations)
        + ",first_event_date=" + sql_literal(first_date)
        + ",last_event_date=" + sql_literal(last_date)
        + ",report_json=" + sql_literal(report_json)
        + " WHERE run_id=" + sql_literal(run_id) + ";"
    )
    writer.raw(
        "UPDATE warehouse_sources SET latest_source_hash=" + sql_literal(source_hash)
        + ",latest_source_version=" + sql_literal(source_version)
        + ",latest_ingested_at=" + sql_literal(imported_at)
        + ",fighter_rows=" + str(fighter_count)
        + ",bout_rows=" + str(bout_count)
        + ",detailed_bout_rows=" + str(detailed_count)
        + " WHERE source_key=" + sql_literal(SOURCE_KEY) + ";"
    )
    writer.close()
    connection.close()

    report["sql_bytes"] = args.output.stat().st_size
    report["sql_statements"] = writer.statements
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
