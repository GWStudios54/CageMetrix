#!/usr/bin/env python3
"""Prepare generated MMA snapshot SQL for Cloudflare D1.

The upstream importers deliberately produce large multi-row INSERT statements for
local efficiency. D1 imposes a much smaller per-statement ceiling than SQLite's
usual local defaults, so a valid generated snapshot can otherwise fail remotely
with ``SQLITE_TOOBIG: statement too long``.

This preflight keeps source ordering intact, removes explicit transaction-control
statements (Wrangler manages remote execution), and splits oversized ``INSERT ...
VALUES`` statements by row while respecting SQL string quoting. Output files are
also byte-bounded for predictable Wrangler uploads.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

DEFAULT_MAX_STATEMENT_BYTES = 64_000
DEFAULT_MAX_FILE_BYTES = 700_000
TRANSACTION_CONTROL = re.compile(
    r"^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|SAVEPOINT\b.*|RELEASE(?:\s+SAVEPOINT)?\b.*|ROLLBACK(?:\s+TO(?:\s+SAVEPOINT)?)?\b.*)$",
    re.IGNORECASE | re.DOTALL,
)
VALUES_TOKEN = re.compile(r"\bVALUES\b", re.IGNORECASE)


def byte_len(text: str) -> int:
    return len(text.encode("utf-8"))


def iter_sql_statements(text: str) -> Iterable[str]:
    """Yield semicolon-terminated SQL statements, respecting quoted strings."""
    buf: list[str] = []
    in_quote = False
    i = 0
    while i < len(text):
        ch = text[i]
        buf.append(ch)
        if in_quote:
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    buf.append(text[i + 1])
                    i += 1
                else:
                    in_quote = False
        else:
            if ch == "'":
                in_quote = True
            elif ch == ";":
                statement = "".join(buf).strip()
                if statement:
                    yield statement
                buf = []
        i += 1

    remainder = "".join(buf).strip()
    if in_quote:
        raise ValueError("Generated SQL ended inside a quoted string")
    if remainder:
        raise ValueError(f"Generated SQL contains an unterminated statement: {remainder[:120]!r}")


def is_transaction_control(statement: str) -> bool:
    normalized = statement.strip()
    if normalized.endswith(";"):
        normalized = normalized[:-1].strip()
    return bool(TRANSACTION_CONTROL.match(normalized))


def split_value_rows(body: str) -> list[str]:
    """Split ``(row),(row)`` at top-level commas without touching quoted data."""
    rows: list[str] = []
    start: int | None = None
    depth = 0
    in_quote = False
    i = 0

    while i < len(body):
        ch = body[i]
        if in_quote:
            if ch == "'":
                if i + 1 < len(body) and body[i + 1] == "'":
                    i += 1
                else:
                    in_quote = False
        else:
            if ch == "'":
                in_quote = True
            elif ch == "(":
                if depth == 0:
                    start = i
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth < 0:
                    raise ValueError("Unbalanced closing parenthesis in INSERT VALUES")
                if depth == 0:
                    if start is None:
                        raise ValueError("Missing row start in INSERT VALUES")
                    rows.append(body[start : i + 1].strip())
                    start = None
            elif depth == 0 and ch not in {",", " ", "\t", "\r", "\n"}:
                raise ValueError(f"Unexpected token between INSERT rows near {body[max(0, i-20):i+40]!r}")
        i += 1

    if in_quote or depth != 0 or start is not None:
        raise ValueError("Unbalanced INSERT VALUES payload")
    if not rows:
        raise ValueError("No rows found in INSERT VALUES payload")
    return rows


def split_oversized_insert(statement: str, max_statement_bytes: int) -> list[str]:
    statement = statement.strip()
    if byte_len(statement) <= max_statement_bytes:
        return [statement]

    match = VALUES_TOKEN.search(statement)
    if not match or not statement[: match.start()].lstrip().upper().startswith("INSERT"):
        raise ValueError(
            f"SQL statement is {byte_len(statement)} bytes (limit {max_statement_bytes}) and is not a splittable INSERT ... VALUES statement"
        )

    prefix = statement[: match.end()].rstrip()
    body = statement[match.end() :].strip()
    if body.endswith(";"):
        body = body[:-1].rstrip()
    rows = split_value_rows(body)

    chunks: list[str] = []
    current: list[str] = []
    for row in rows:
        candidate_rows = current + [row]
        candidate = f"{prefix}\n" + ",\n".join(candidate_rows) + ";"
        if current and byte_len(candidate) > max_statement_bytes:
            chunks.append(f"{prefix}\n" + ",\n".join(current) + ";")
            current = [row]
        else:
            current = candidate_rows

        single = f"{prefix}\n{row};"
        if byte_len(single) > max_statement_bytes:
            raise ValueError(
                f"A single INSERT row is {byte_len(single)} bytes, above D1 preflight limit {max_statement_bytes}"
            )

    if current:
        chunks.append(f"{prefix}\n" + ",\n".join(current) + ";")

    if any(byte_len(chunk) > max_statement_bytes for chunk in chunks):
        raise AssertionError("D1 rechunking emitted an oversized statement")
    return chunks


@dataclass
class OutputWriter:
    directory: Path
    max_file_bytes: int
    file_index: int = 0
    parts: list[str] | None = None
    size: int = 0
    files: list[str] | None = None

    def __post_init__(self) -> None:
        self.parts = []
        self.files = []

    def add(self, statement: str) -> None:
        line = statement.rstrip() + "\n"
        size = byte_len(line)
        if size > self.max_file_bytes:
            raise ValueError(f"Prepared statement is {size} bytes, larger than output-file limit {self.max_file_bytes}")
        if self.parts and self.size + size > self.max_file_bytes:
            self.flush()
        self.parts.append(line)
        self.size += size

    def flush(self) -> None:
        if not self.parts:
            return
        name = f"{self.file_index:05d}-d1.sql"
        (self.directory / name).write_text("".join(self.parts), encoding="utf-8")
        self.files.append(name)
        self.file_index += 1
        self.parts = []
        self.size = 0


def prepare(
    input_dir: Path,
    output_dir: Path,
    *,
    max_statement_bytes: int = DEFAULT_MAX_STATEMENT_BYTES,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
) -> dict[str, object]:
    if max_statement_bytes <= 0 or max_file_bytes <= 0:
        raise ValueError("Byte ceilings must be positive")
    if max_statement_bytes >= max_file_bytes:
        raise ValueError("Statement ceiling must be smaller than output-file ceiling")

    source_files = sorted(input_dir.glob("*.sql"))
    if not source_files:
        raise FileNotFoundError(f"No generated SQL files found under {input_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    for old in output_dir.glob("*.sql"):
        old.unlink()

    writer = OutputWriter(output_dir, max_file_bytes)
    source_statements = prepared_statements = transaction_statements = split_statements = 0
    max_source_statement = max_prepared_statement = 0

    for source in source_files:
        text = source.read_text(encoding="utf-8")
        for statement in iter_sql_statements(text):
            source_statements += 1
            source_size = byte_len(statement)
            max_source_statement = max(max_source_statement, source_size)
            if is_transaction_control(statement):
                transaction_statements += 1
                continue
            chunks = split_oversized_insert(statement, max_statement_bytes)
            if len(chunks) > 1:
                split_statements += 1
            for chunk in chunks:
                prepared_size = byte_len(chunk)
                if prepared_size > max_statement_bytes:
                    raise AssertionError("Prepared SQL exceeded D1 statement ceiling")
                writer.add(chunk)
                prepared_statements += 1
                max_prepared_statement = max(max_prepared_statement, prepared_size)
    writer.flush()

    audit: dict[str, object] = {
        "source_files": len(source_files),
        "output_files": len(writer.files),
        "source_statements": source_statements,
        "prepared_statements": prepared_statements,
        "transaction_statements_removed": transaction_statements,
        "oversized_statements_split": split_statements,
        "max_source_statement_bytes": max_source_statement,
        "max_prepared_statement_bytes": max_prepared_statement,
        "max_statement_bytes": max_statement_bytes,
        "max_file_bytes": max_file_bytes,
        "files": writer.files,
    }
    (output_dir.parent / "d1-import-plan.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    return audit


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=".cache/mma-master/sql")
    parser.add_argument("--output", default=".cache/mma-master/d1-sql")
    parser.add_argument("--max-statement-bytes", type=int, default=DEFAULT_MAX_STATEMENT_BYTES)
    parser.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    args = parser.parse_args()

    audit = prepare(
        Path(args.input),
        Path(args.output),
        max_statement_bytes=args.max_statement_bytes,
        max_file_bytes=args.max_file_bytes,
    )
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
