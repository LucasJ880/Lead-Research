"""Structured logging configuration for the scraper service."""

import logging
import sys
from datetime import datetime, timezone

from src.core.config import settings


class StructuredFormatter(logging.Formatter):
    """Formatter that outputs structured log lines."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        level = record.levelname.upper()
        module = record.name
        message = record.getMessage()

        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)

        log_line = f"{timestamp} | {level:<8} | {module} | {message}"

        if record.exc_text:
            log_line = f"{log_line}\n{record.exc_text}"

        return log_line


class _FlushHandler(logging.StreamHandler):
    """StreamHandler that flushes after every emit for real-time visibility."""

    def emit(self, record: logging.LogRecord) -> None:
        super().emit(record)
        self.flush()


def _configure_root_logger() -> None:
    """Configure the root logger with structured formatting."""
    root = logging.getLogger()
    root.setLevel(settings.LOG_LEVEL.upper())

    if not root.handlers:
        handler = _FlushHandler(sys.stderr)
        handler.setFormatter(StructuredFormatter())
        root.addHandler(handler)


_configure_root_logger()


def get_logger(name: str) -> logging.Logger:
    """Return a named logger that inherits the structured configuration.

    Args:
        name: Logger name, typically ``__name__`` of the calling module.
    """
    return logging.getLogger(name)
