"""Pytest configuration for scraper service tests.

Adds the scraper ``src`` directory to ``sys.path`` so tests can use the
same ``from src.xxx`` imports the application uses, without requiring
the package to be installed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_SCRAPER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRAPER_ROOT))

# Ensure tests don't accidentally hit a real Redis/Postgres if envs leak in.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:9/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:9/0")
os.environ.setdefault("SCRAPER_API_KEY", "test-key")
