"""Celery app: Redis broker, eager mode for tests, hourly sweep beat."""

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "careflow",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workflow.tasks._base"],
)

celery_app.conf.update(
    task_always_eager=settings.task_eager,
    task_acks_on_failure_or_timeout=True,
    task_reject_on_worker_lost=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "hourly-workflow-sweep": {
            "task": "careflow.sweep_tick",
            "schedule": 3600.0,
        },
    },
)


@celery_app.task(name="careflow.sweep_tick")
def sweep_tick() -> dict:
    """Beat entrypoint: publish the reminder + recovery sweeps as events."""
    from app.core.db import SessionLocal
    from app.workflow import event_bus

    db = SessionLocal()
    try:
        reminder = event_bus.publish_event(db, "reminder.sweep", {})
        recovery = event_bus.publish_event(db, "reconciliation.sweep", {})
    finally:
        db.close()
    return {"reminder": str(reminder.id), "recovery": str(recovery.id)}


__all__ = ["celery_app", "sweep_tick"]
