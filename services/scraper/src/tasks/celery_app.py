"""Celery application configuration."""

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

celery_app.conf.beat_schedule = {
    "crawl-all-active-sources-daily": {
        "task": "src.tasks.crawl_tasks.crawl_all_active_sources",
        "schedule": crontab(hour=2, minute=0),
    },
}

celery_app.autodiscover_tasks(["src.tasks"])
