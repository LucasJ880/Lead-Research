"""Celery application configuration with frequency-tiered scheduling."""

from celery import Celery
from celery.schedules import crontab

from src.core.config import settings

celery_app = Celery(
    "scraper",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=86400,
)

# Tiered schedule based on industry_fit_score:
#   High-fit (>=60): every 6 hours → hospitals, housing, hospitality
#   Medium-fit (30-59): daily → state/provincial, municipal, school, university
#   Low-fit (<30): weekly → generic, less relevant sources
celery_app.conf.beat_schedule = {
    "crawl-high-fit-0600": {
        "task": "src.tasks.crawl_tasks.crawl_by_fit_tier",
        "schedule": crontab(hour=6, minute=0),
        "args": ("high",),
    },
    "crawl-high-fit-1200": {
        "task": "src.tasks.crawl_tasks.crawl_by_fit_tier",
        "schedule": crontab(hour=12, minute=0),
        "args": ("high",),
    },
    "crawl-high-fit-1800": {
        "task": "src.tasks.crawl_tasks.crawl_by_fit_tier",
        "schedule": crontab(hour=18, minute=0),
        "args": ("high",),
    },
    "crawl-high-fit-0000": {
        "task": "src.tasks.crawl_tasks.crawl_by_fit_tier",
        "schedule": crontab(hour=0, minute=0),
        "args": ("high",),
    },
    "crawl-medium-fit-morning": {
        "task": "src.tasks.crawl_tasks.crawl_by_fit_tier",
        "schedule": crontab(hour=7, minute=30),
        "args": ("medium",),
    },
    "crawl-medium-fit-evening": {
        "task": "src.tasks.crawl_tasks.crawl_by_fit_tier",
        "schedule": crontab(hour=19, minute=30),
        "args": ("medium",),
    },
    "crawl-low-fit-weekly": {
        "task": "src.tasks.crawl_tasks.crawl_by_fit_tier",
        "schedule": crontab(hour=3, minute=0, day_of_week="sunday"),
        "args": ("low",),
    },
    "extract-pending-documents": {
        "task": "src.tasks.extract_documents.extract_pending_documents",
        "schedule": crontab(hour="*/4", minute=15),
    },
}

celery_app.autodiscover_tasks(["src.tasks"], related_name="crawl_tasks")
celery_app.autodiscover_tasks(["src.tasks"], related_name="extract_documents")
