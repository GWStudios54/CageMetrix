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

# Cloudflare D1 rejects the original 500-row multi-value statements as
# SQLITE_TOOBIG. Twenty-five rows keeps each SQL statement comfortably below
# the remote statement limit while preserving the base loader's file chunking.
module.ROWS_PER_INSERT = 25
module.main()
