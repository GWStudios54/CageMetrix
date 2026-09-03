#!/usr/bin/env python3
"""Prepare an immutable CageMetrix MMA master-data snapshot for Cloudflare D1.

Default source: LeandroIber/mmastats on Kaggle. The source is a DuckDB database
covering broad professional MMA career history across thousands of organizations.
This script does not touch production CMR tables. It converts the source into
small, ordered SQL chunks that can be applied safely by Wrangler.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SOURCE_KEY = "leandroiber_mmastats"
SOURCE_NAME = "MMA Global Database (Leandro Iber)"
DATASET_HOMEPAGE = "https://www.kaggle.com/datasets/leandroiber/mmastats"
CODE_HOMEPAGE = "https://github.com/LeandroIber/Database-complete-mma"
CODE_LICENSE = "MIT"
UPSTREAM_SOURCES = ["Sherdog Fight Finder", "UFCStats.com", "Wikipedia", "statleaders.ufc.com"]
MIN_FIGHTS = 120_000
MIN_FIGHTERS = 15_000
ROWS_PER_INSERT = 100
MAX_SQL_FILE_BYTES = 900_000


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


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
    text = str(value)
    return "'" + text.replace("'", "''") + "'"


def as_bool(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value != 0)
    return int(str(value).strip().lower() in {"1", "true", "t", "yes", "y"})


def as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None


def row_dict(description: list[tuple], row: tuple) -> dict[str, Any]:
    return {description[i][0]: row[i] for i in range(len(row))}


def table_columns(con, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info('{table}')").fetchall()}


def require_columns(con, table: str, required: set[str]) -> None:
    cols = table_columns(con, table)
    missing = sorted(required - cols)
    if missing:
        raise RuntimeError(f"{table} is missing required columns: {', '.join(missing)}")


def first(d: dict[str, Any] | None, *names: str) -> Any:
    if not d:
        return None
    for name in names:
        if name in d:
            return d[name]
    return None


class SqlChunkWriter:
    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.index = 10
        self.parts: list[str] = []
        self.size = 0
        self.files: list[str] = []

    def _start(self) -> None:
        if not self.parts:
            self.parts = ["BEGIN;\n"]
            self.size = len(self.parts[0].encode())

    def add(self, statement: str) -> None:
        self._start()
        encoded = len(statement.encode())
        if self.size + encoded + 10 > MAX_SQL_FILE_BYTES and len(self.parts) > 1:
            self.flush()
            self._start()
        self.parts.append(statement)
        if not statement.endswith("\n"):
            self.parts.append("\n")
        self.size += encoded + 1

    def flush(self) -> None:
        if not self.parts:
            return
        self.parts.append("COMMIT;\n")
        name = f"{self.index:04d}-data.sql"
        (self.directory / name).write_text("".join(self.parts), encoding="utf-8")
        self.files.append(name)
        self.index += 10
        self.parts = []
        self.size = 0


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


def resolve_source(args: argparse.Namespace) -> Path:
    if args.source:
        path = Path(args.source).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(path)
        return path

    import kagglehub  # installed only for the data-sync workflow

    download_dir = Path(args.download_dir).resolve()
    download_dir.mkdir(parents=True, exist_ok=True)
    root = Path(kagglehub.dataset_download("leandroiber/mmastats", output_dir=str(download_dir)))
    candidates = sorted(root.rglob("*.duckdb"), key=lambda p: p.stat().st_size, reverse=True)
    if not candidates:
        raise RuntimeError(f"Kaggle dataset contained no .duckdb file under {root}")
    return candidates[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", help="Existing dataset_global_v3.duckdb path")
    parser.add_argument("--download-dir", default=".cache/mma-master/source")
    parser.add_argument("--output", default=".cache/mma-master/sql")
    args = parser.parse_args()

    try:
        import duckdb
    except ImportError as exc:
        raise RuntimeError("Install importer dependencies: pip install duckdb kagglehub") from exc

    source = resolve_source(args)
    output = Path(args.output).resolve()
    if output.exists():
        for old in output.glob("*.sql"):
            old.unlink()
    output.mkdir(parents=True, exist_ok=True)

    source_hash = sha256_file(source)
    snapshot_id = source_hash[:20]
    started = utc_now()
    con = duckdb.connect(str(source), read_only=True)

    required_tables = {"fighters_master", "fights_career_longitudinal", "fights_master_typed"}
    found_tables = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
    missing_tables = sorted(required_tables - found_tables)
    if missing_tables:
        raise RuntimeError(f"Source database missing tables: {', '.join(missing_tables)}")

    require_columns(con, "fighters_master", {"fighter_id", "fighter_name"})
    require_columns(
        con,
        "fights_career_longitudinal",
        {"fight_id", "organization", "event_name", "event_date", "fighter_1", "fighter_2"},
    )
    require_columns(con, "fights_master_typed", {"fight_id", "fighter_1", "fighter_2"})

    fighter_count = con.execute("SELECT COUNT(*) FROM fighters_master").fetchone()[0]
    fight_count = con.execute("SELECT COUNT(*) FROM fights_career_longitudinal").fetchone()[0]
    technical_count = con.execute(
        "SELECT COUNT(DISTINCT fight_id) FROM fights_master_typed WHERE COALESCE(has_stats, TRUE)"
    ).fetchone()[0]
    organization_count = con.execute(
        "SELECT COUNT(DISTINCT organization) FROM fights_career_longitudinal"
    ).fetchone()[0]
    source_max_date = str(con.execute("SELECT MAX(event_date) FROM fights_career_longitudinal").fetchone()[0])

    if fighter_count < MIN_FIGHTERS or fight_count < MIN_FIGHTS:
        raise RuntimeError(
            f"Source coverage regressed: {fighter_count} fighters / {fight_count} fights; "
            f"expected at least {MIN_FIGHTERS} / {MIN_FIGHTS}"
        )

    # Build source-fighter lookup. Duplicate normalized names remain deliberately unresolved.
    fighter_rows = con.execute("SELECT * FROM fighters_master ORDER BY fighter_id").fetchall()
    fighter_desc = con.description
    fighter_dicts = [row_dict(fighter_desc, row) for row in fighter_rows]
    ids_by_name: dict[str, list[str]] = defaultdict(list)
    for f in fighter_dicts:
        ids_by_name[normalize_name(f.get("fighter_name"))].append(str(f.get("fighter_id")))

    # Technical rows are small enough to index in memory. Reject duplicates instead of silently exploding joins.
    tech_rows = con.execute("SELECT * FROM fights_master_typed").fetchall()
    tech_desc = con.description
    tech_by_fight: dict[str, dict[str, Any]] = {}
    duplicate_technical_ids: set[str] = set()
    for raw in tech_rows:
        t = row_dict(tech_desc, raw)
        fight_id = str(t.get("fight_id"))
        if fight_id in tech_by_fight:
            duplicate_technical_ids.add(fight_id)
            continue
        tech_by_fight[fight_id] = t
    for fight_id in duplicate_technical_ids:
        tech_by_fight.pop(fight_id, None)

    init_sql = f"""BEGIN;
INSERT OR IGNORE INTO mma_source_registry (
  source_key,display_name,dataset_homepage,code_homepage,code_license,upstream_sources_json,notes
) VALUES (
  {sql(SOURCE_KEY)},{sql(SOURCE_NAME)},{sql(DATASET_HOMEPAGE)},{sql(CODE_HOMEPAGE)},
  {sql(CODE_LICENSE)},{sql(json.dumps(UPSTREAM_SOURCES))},
  {sql('Private research mirror. Broad career results are sourced primarily from Sherdog; granular technical stats are primarily UFCStats-derived. Raw source provenance is retained and CageMetrix production predictions remain separate.')}
);
INSERT OR REPLACE INTO mma_source_snapshots (
  source_key,snapshot_id,source_sha256,source_version,source_max_date,status,
  fighter_count,fight_count,participant_count,technical_fight_count,organization_count,started_at,completed_at,error_text
) VALUES (
  {sql(SOURCE_KEY)},{sql(snapshot_id)},{sql(source_hash)},{sql('kaggle-latest')},{sql(source_max_date)},'loading',
  {fighter_count},{fight_count},{fight_count * 2},{technical_count},{organization_count},{sql(started)},NULL,NULL
);
COMMIT;
"""
    (output / "0000-init.sql").write_text(init_sql, encoding="utf-8")

    writer = SqlChunkWriter(output)
    fighter_columns = [
        "source_key", "snapshot_id", "source_fighter_id", "fighter_name", "normalized_name",
        "dob", "height_cm", "reach_cm", "stance", "nationality", "gym",
    ]
    fighter_values = []
    for f in fighter_dicts:
        fighter_values.append([
            SOURCE_KEY, snapshot_id, str(f.get("fighter_id")), f.get("fighter_name"),
            normalize_name(f.get("fighter_name")), f.get("dob"), f.get("height_cm"), f.get("reach_cm"),
            f.get("stance"), f.get("nationality"), f.get("gym"),
        ])
    for statement in insert_statements("mma_fighters", fighter_columns, fighter_values):
        writer.add(statement)

    fight_columns = [
        "source_key", "snapshot_id", "source_fight_id", "organization", "event_name", "event_date",
        "event_year", "event_location", "weight_class", "is_major_org", "outcome", "winner_side",
        "is_title_fight", "method_raw", "method_normalized", "method_detail", "round_num",
        "time_finish_seconds", "referee", "has_technical_stats",
    ]
    participant_columns = [
        "source_key", "snapshot_id", "source_fight_id", "side", "source_fighter_id", "fighter_name",
        "normalized_name", "result", "height_cm", "weight_kg", "reach_cm", "stance", "dob", "gym",
        "nationality", "knockdowns", "sig_str_landed", "sig_str_attempted", "td_landed", "td_attempted",
        "ctrl_seconds",
    ]

    fight_batch: list[list[Any]] = []
    participant_batch: list[list[Any]] = []
    unresolved_identity_rows = 0
    matched_technical = 0

    cursor = con.execute("SELECT * FROM fights_career_longitudinal ORDER BY event_date, fight_id")
    fight_desc = cursor.description
    while True:
        raw_rows = cursor.fetchmany(2000)
        if not raw_rows:
            break
        for raw in raw_rows:
            f = row_dict(fight_desc, raw)
            fight_id = str(f.get("fight_id"))
            t = tech_by_fight.get(fight_id)
            f1_name = str(f.get("fighter_1") or "")
            f2_name = str(f.get("fighter_2") or "")
            n1 = normalize_name(f1_name)
            n2 = normalize_name(f2_name)
            f1_ids = ids_by_name.get(n1, [])
            f2_ids = ids_by_name.get(n2, [])
            f1_id = f1_ids[0] if len(f1_ids) == 1 else None
            f2_id = f2_ids[0] if len(f2_ids) == 1 else None
            unresolved_identity_rows += int(f1_id is None) + int(f2_id is None)

            winner_side = as_int(f.get("winner_side"))
            method_raw = f.get("method")
            method_norm = f.get("method_normalized")
            result1 = result2 = "U"
            outcome = "unknown"
            if winner_side == 1:
                result1, result2, outcome = "W", "L", "fighter_1_win"
            elif winner_side == 2:
                result1, result2, outcome = "L", "W", "fighter_2_win"
            else:
                text = f"{method_raw or ''} {method_norm or ''}".lower()
                is_nc = as_bool(first(t, "is_no_contest")) or "no contest" in text or "overturned" in text
                if is_nc:
                    result1 = result2 = "NC"
                    outcome = "no_contest"
                elif "draw" in text:
                    result1 = result2 = "D"
                    outcome = "draw"

            tech_for_side: dict[int, dict[str, Any] | None] = {1: None, 2: None}
            has_tech = 0
            if t and as_bool(first(t, "has_stats")):
                tn1 = normalize_name(t.get("fighter_1"))
                tn2 = normalize_name(t.get("fighter_2"))
                if tn1 == n1 and tn2 == n2:
                    tech_for_side = {1: t, 2: t}
                    has_tech = 1
                elif tn1 == n2 and tn2 == n1:
                    # A reversed source orientation is handled below with swapped prefixes.
                    tech_for_side = {1: {**t, "_swap": True}, 2: {**t, "_swap": True}}
                    has_tech = 1
            matched_technical += has_tech

            fight_batch.append([
                SOURCE_KEY, snapshot_id, fight_id, str(f.get("organization") or "unknown").lower(),
                f.get("event_name") or "Unknown event", f.get("event_date"), as_int(f.get("event_year")),
                f.get("event_location"), f.get("weight_class"), as_bool(f.get("is_major_org")), outcome,
                winner_side, as_bool(f.get("is_title_fight")), method_raw, method_norm, f.get("method_detail"),
                as_int(f.get("round_num")), as_int(f.get("time_finish_seconds")), f.get("referee"), has_tech,
            ])

            def participant(side: int, name: str, norm: str, source_id: str | None, result: str) -> list[Any]:
                prefix = "f1" if side == 1 else "f2"
                tech = tech_for_side[side]
                if tech and tech.get("_swap"):
                    prefix = "f2" if side == 1 else "f1"
                return [
                    SOURCE_KEY, snapshot_id, fight_id, side, source_id, name, norm, result,
                    f.get(f"f{side}_height_cm"), f.get(f"f{side}_weight_kg"),
                    first(tech, f"{prefix}_reach_cm"), first(tech, f"{prefix}_stance"), first(tech, f"{prefix}_dob"),
                    first(tech, f"{prefix}_gym") or f.get(f"f{side}_gym"),
                    first(tech, f"{prefix}_nationality") or f.get(f"f{side}_nationality"),
                    as_int(first(tech, f"{prefix}_kd")), as_int(first(tech, f"{prefix}_sig_str_landed")),
                    as_int(first(tech, f"{prefix}_sig_str_attempted")), as_int(first(tech, f"{prefix}_td_landed")),
                    as_int(first(tech, f"{prefix}_td_attempted")), as_int(first(tech, f"{prefix}_ctrl_seconds")),
                ]

            participant_batch.append(participant(1, f1_name, n1, f1_id, result1))
            participant_batch.append(participant(2, f2_name, n2, f2_id, result2))

        if len(fight_batch) >= 2000:
            for statement in insert_statements("mma_fights", fight_columns, fight_batch):
                writer.add(statement)
            for statement in insert_statements("mma_fight_participants", participant_columns, participant_batch):
                writer.add(statement)
            fight_batch = []
            participant_batch = []

    if fight_batch:
        for statement in insert_statements("mma_fights", fight_columns, fight_batch):
            writer.add(statement)
        for statement in insert_statements("mma_fight_participants", participant_columns, participant_batch):
            writer.add(statement)
    writer.flush()

    completed = utc_now()
    finalize_sql = f"""BEGIN;
UPDATE mma_source_snapshots
SET status='complete', completed_at={sql(completed)}, error_text=NULL,
    fighter_count={fighter_count}, fight_count={fight_count}, participant_count={fight_count * 2},
    technical_fight_count={matched_technical}, organization_count={organization_count}
WHERE source_key={sql(SOURCE_KEY)} AND snapshot_id={sql(snapshot_id)};
UPDATE mma_source_registry
SET display_name={sql(SOURCE_NAME)}, dataset_homepage={sql(DATASET_HOMEPAGE)},
    code_homepage={sql(CODE_HOMEPAGE)}, code_license={sql(CODE_LICENSE)},
    upstream_sources_json={sql(json.dumps(UPSTREAM_SOURCES))}, active_snapshot_id={sql(snapshot_id)},
    active_since={sql(completed)}
WHERE source_key={sql(SOURCE_KEY)};
COMMIT;
"""
    (output / "9999-finalize.sql").write_text(finalize_sql, encoding="utf-8")

    summary = {
        "source_key": SOURCE_KEY,
        "source_file": source.name,
        "source_sha256": source_hash,
        "snapshot_id": snapshot_id,
        "source_max_date": source_max_date,
        "fighters": fighter_count,
        "fights": fight_count,
        "participants": fight_count * 2,
        "organizations": organization_count,
        "technical_fights_source": technical_count,
        "technical_fights_matched": matched_technical,
        "duplicate_technical_fight_ids_excluded": len(duplicate_technical_ids),
        "participant_identity_rows_unresolved": unresolved_identity_rows,
        "sql_chunks": 2 + len(writer.files),
        "generated_at": completed,
    }
    (output.parent / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
