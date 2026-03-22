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

# Daily crawl schedule — all active sources crawled once per day.
# Runs at 9:00 AM UTC (5:00 AM Toronto / EST) so fresh data is ready
# before the business day. CanadaBuys CSV refreshes at 7-8:30 AM EST,
# so a second pass for high-priority sources catches that update.
celery_app.conf.beat_schedule = {
    "crawl-all-daily": {
        "task": "src.tasks.crawl_tasks.crawl_all_active_sources",
        "schedule": crontab(hour=9, minute=0),
    },
    "extract-pending-documents": {
        "task": "src.tasks.extract_documents.extract_pending_documents",
        "schedule": crontab(hour="*/6", minute=15),
    },
    "translate-pending-opportunities": {
        "task": "src.tasks.translate_tasks.translate_pending_opportunities",
        "schedule": crontab(hour="*/6", minute=30),
    },
}

celery_app.autodiscover_tasks(["src.tasks"], related_name="crawl_tasks")
celery_app.autodiscover_tasks(["src.tasks"], related_name="extract_documents")
celery_app.autodiscover_tasks(["src.tasks"], related_name="translate_tasks")
celery_app.autodiscover_tasks(["src.tasks"], related_name="auto_analyze")
celery_app.autodiscover_tasks(["src.tasks"], related_name="discover_documents")
