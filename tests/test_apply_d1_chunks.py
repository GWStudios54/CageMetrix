#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "apply_d1_chunks.py"
spec = importlib.util.spec_from_file_location("apply_d1_chunks", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def test_documented_terminal_poll_after_processed_queries_is_success() -> None:
    result = module.CommandResult(
        1,
        "Starting import...\nProcessed 30 queries.\n[ERROR] Not currently importing anything.\n",
    )
    classification = module.classify_result(result)
    assert classification.kind == "terminal_success"
    assert classification.processed_queries == 30


def test_terminal_poll_without_processed_queries_retries() -> None:
    result = module.CommandResult(1, "[ERROR] Not currently importing anything.\n")
    assert module.classify_result(result).kind == "retry"


def test_transient_transport_failure_retries_then_succeeds() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        (directory / "00000-d1.sql").write_text("SELECT 1;\n", encoding="utf-8")
        calls: list[str] = []
        sleeps: list[float] = []

        def runner(path: Path, database: str):
            calls.append(path.name)
            if len(calls) == 1:
                return module.CommandResult(1, "fetch failed: ECONNRESET")
            return module.CommandResult(0, "success")

        audit = module.apply_directory(
            directory,
            "cagemetrix",
            runner=runner,
            sleep_fn=sleeps.append,
            max_attempts=3,
            settle_seconds=1,
            backoff_seconds=2,
        )
        assert calls == ["00000-d1.sql", "00000-d1.sql"]
        assert sleeps == [2, 1]
        assert audit["files_completed"] == 1
        assert audit["retry_attempts"] == 1


def test_terminal_poll_completion_continues_without_replay() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        (directory / "00000-d1.sql").write_text("SELECT 1;\n", encoding="utf-8")
        calls: list[str] = []

        def runner(path: Path, database: str):
            calls.append(path.name)
            return module.CommandResult(1, "Processed 42 queries.\nNot currently importing anything.\n")

        audit = module.apply_directory(directory, "cagemetrix", runner=runner, sleep_fn=lambda _: None)
        assert calls == ["00000-d1.sql"]
        assert audit["terminal_poll_completions"] == 1
        assert audit["processed_queries_at_terminal_poll"] == 42
        assert audit["files_completed"] == 1


def test_fatal_sql_error_is_not_retried() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        (directory / "00000-d1.sql").write_text("SELECT 1;\n", encoding="utf-8")
        calls = 0

        def runner(path: Path, database: str):
            nonlocal calls
            calls += 1
            return module.CommandResult(1, "SQLITE_CONSTRAINT: foreign key constraint failed")

        try:
            module.apply_directory(directory, "cagemetrix", runner=runner, sleep_fn=lambda _: None)
        except RuntimeError as exc:
            assert "failed" in str(exc)
        else:
            raise AssertionError("Expected fatal SQL error to fail")
        assert calls == 1


if __name__ == "__main__":
    test_documented_terminal_poll_after_processed_queries_is_success()
    test_terminal_poll_without_processed_queries_retries()
    test_transient_transport_failure_retries_then_succeeds()
    test_terminal_poll_completion_continues_without_replay()
    test_fatal_sql_error_is_not_retried()
    print("apply_d1_chunks tests passed")
