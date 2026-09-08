#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "prepare_d1_import.py"
spec = importlib.util.spec_from_file_location("prepare_d1_import", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def execute_prepared(directory: Path) -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, payload TEXT)")
    for path in sorted(directory.glob("*.sql")):
        for statement in module.iter_sql_statements(path.read_text(encoding="utf-8")):
            con.execute(statement)
    return con


def test_rechunks_oversized_insert_and_preserves_data() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source"
        target = root / "target"
        source.mkdir()
        rows = []
        for i in range(120):
            payload = (f"row-{i}; comma, quote ' preserved " + "x" * 1200).replace("'", "''")
            rows.append(f"({i},'{payload}')")
        giant = "INSERT OR REPLACE INTO t (id,payload) VALUES\n" + ",\n".join(rows) + ";\n"
        (source / "0010-data.sql").write_text("BEGIN;\n" + giant + "COMMIT;\n", encoding="utf-8")

        audit = module.prepare(source, target, max_statement_bytes=16_000, max_file_bytes=40_000)
        assert audit["oversized_statements_split"] == 1
        assert audit["transaction_statements_removed"] == 2
        assert audit["max_prepared_statement_bytes"] <= 16_000
        assert audit["output_files"] > 1

        for path in target.glob("*.sql"):
            text = path.read_text(encoding="utf-8")
            assert "BEGIN;" not in text
            assert "COMMIT;" not in text
            for statement in module.iter_sql_statements(text):
                assert module.byte_len(statement) <= 16_000

        con = execute_prepared(target)
        assert con.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 120
        assert con.execute("SELECT payload FROM t WHERE id=7").fetchone()[0].startswith("row-7; comma, quote ' preserved")


def test_rejects_single_row_above_ceiling() -> None:
    statement = "INSERT INTO t (id,payload) VALUES (1,'" + ("z" * 20_000) + "');"
    try:
        module.split_oversized_insert(statement, 4_000)
    except ValueError as exc:
        assert "single INSERT row" in str(exc)
    else:
        raise AssertionError("Expected an oversized single row to fail preflight")


if __name__ == "__main__":
    test_rechunks_oversized_insert_and_preserves_data()
    test_rejects_single_row_above_ceiling()
    print("prepare_d1_import tests passed")
