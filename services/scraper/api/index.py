"""Vercel entry point: exposes the FastAPI app as one serverless function."""

from src.api.main import app  # noqa: F401  (Vercel looks for a module-level ASGI `app`)
