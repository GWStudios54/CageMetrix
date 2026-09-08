#!/usr/bin/env python3
"""Apply prepared MMA snapshot SQL chunks to Cloudflare D1 robustly.

Cloudflare's D1 bulk-import API documents ``Not currently importing anything.``
as a terminal poll condition. Some Wrangler versions surface that condition as a
non-zero exit even after reporting that queries were processed. Treat that exact
case as completed, retry genuine transient transport failures with backoff, and
leave data-integrity verification to the exact remote row-count gate that follows
this step in CI.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

TERMINAL_POLL_TEXT = "Not currently importing anything."
PROCESSED_RE = re.compile(r"Processed\s+(\d+)\s+queries?\.", re.IGNORECASE)
TRANSIENT_MARKERS = (
    "econnreset",
    "etimedout",
    "socket hang up",
    "fetch failed",
    "network error",
    "connection reset",
    "connection timed out",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "too many requests",
)


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    output: str


@dataclass(frozen=True)
class Classification:
    kind: str
    processed_queries: int = 0


def classify_result(result: CommandResult) -> Classification:
    if result.returncode == 0:
        return Classification("success")

    processed = [int(match.group(1)) for match in PROCESSED_RE.finditer(result.output)]
    processed_queries = max(processed, default=0)
    if TERMINAL_POLL_TEXT in result.output and processed_queries > 0:
        # Cloudflare's documented import polling example treats this as a terminal
        # condition. Wrangler can nevertheless exit non-zero after processing.
        return Classification("terminal_success", processed_queries)

    lowered = result.output.lower()
    if TERMINAL_POLL_TEXT in result.output or any(marker in lowered for marker in TRANSIENT_MARKERS):
        return Classification("retry")
    return Classification("fatal")


def run_wrangler(file: Path, database: str) -> CommandResult:
    command = [
        "npx",
        "--no-install",
        "wrangler",
        "d1",
        "execute",
        database,
        "--remote",
        "--file",
        str(file),
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
        lines.append(line)
    return CommandResult(process.wait(), "".join(lines))


def apply_directory(
    directory: Path,
    database: str,
    *,
    runner: Callable[[Path, str], CommandResult] = run_wrangler,
    sleep_fn: Callable[[float], None] = time.sleep,
    max_attempts: int = 4,
    settle_seconds: float = 1.0,
    backoff_seconds: float = 3.0,
) -> dict[str, object]:
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise FileNotFoundError(f"No D1 SQL chunks found under {directory}")
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")

    audit: dict[str, object] = {
        "database": database,
        "files_total": len(files),
        "files_completed": 0,
        "terminal_poll_completions": 0,
        "retry_attempts": 0,
        "processed_queries_at_terminal_poll": 0,
    }

    for index, file in enumerate(files, start=1):
        print(f"Applying {file.name} ({index}/{len(files)})", flush=True)
        for attempt in range(1, max_attempts + 1):
            result = runner(file, database)
            classification = classify_result(result)

            if classification.kind in {"success", "terminal_success"}:
                if classification.kind == "terminal_success":
                    audit["terminal_poll_completions"] = int(audit["terminal_poll_completions"]) + 1
                    audit["processed_queries_at_terminal_poll"] = int(audit["processed_queries_at_terminal_poll"]) + classification.processed_queries
                    print(
                        f"Wrangler returned the documented terminal D1 poll condition after "
                        f"processing {classification.processed_queries} queries; continuing to exact remote verification.",
                        flush=True,
                    )
                audit["files_completed"] = int(audit["files_completed"]) + 1
                if settle_seconds:
                    sleep_fn(settle_seconds)
                break

            if classification.kind == "retry" and attempt < max_attempts:
                audit["retry_attempts"] = int(audit["retry_attempts"]) + 1
                wait = backoff_seconds * attempt
                print(
                    f"Transient D1 import state for {file.name}; retrying attempt {attempt + 1}/{max_attempts} in {wait:.1f}s.",
                    flush=True,
                )
                sleep_fn(wait)
                continue

            if classification.kind == "retry":
                raise RuntimeError(f"D1 import remained transient after {max_attempts} attempts for {file.name}")
            raise RuntimeError(f"D1 import failed for {file.name} with exit code {result.returncode}")

    return audit


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".cache/mma-master/d1-sql")
    parser.add_argument("--database", default="cagemetrix")
    parser.add_argument("--max-attempts", type=int, default=4)
    parser.add_argument("--settle-seconds", type=float, default=1.0)
    parser.add_argument("--backoff-seconds", type=float, default=3.0)
    parser.add_argument("--audit", default=".cache/mma-master/d1-apply-audit.json")
    args = parser.parse_args()

    audit = apply_directory(
        Path(args.directory),
        args.database,
        max_attempts=args.max_attempts,
        settle_seconds=args.settle_seconds,
        backoff_seconds=args.backoff_seconds,
    )
    audit_path = Path(args.audit)
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
