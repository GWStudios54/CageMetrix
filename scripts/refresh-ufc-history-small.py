#!/usr/bin/env python3
"""Run the UFC history loader with D1-safe INSERT statement sizes."""

from __future__ import annotations

import importlib.util
from pathlib import Path

TARGET = Path(__file__).with_name("refresh-ufc-history.py")
spec = importlib.util.spec_from_file_location("cagemetrix_refresh_ufc_history", TARGET)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {TARGET}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# Cloudflare D1 rejects the 500-row multi-value statements produced by the
# base loader as SQLITE_TOOBIG. Keep each statement intentionally small; the
# existing file chunker will still group multiple statements per upload.
module.ROWS_PER_INSERT = 25
module.main()
