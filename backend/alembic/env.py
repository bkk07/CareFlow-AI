"""Alembic environment wired to app.core.db metadata (Phase 0)."""

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.core.config import settings  # noqa: E402
from app.core.db import Base  # noqa: E402
from app.domain.auth import models as auth_models  # noqa: E402,F401 — register User metadata
from app.domain.hospital import models as hospital_models  # noqa: E402,F401 — register Hospital metadata
from app.core import audit as audit_module  # noqa: E402,F401 — register AuditEvent metadata
from app.domain.doctor import models as doctor_models  # noqa: E402,F401 — register Doctor metadata
from app.domain.hospital_config import models as config_models  # noqa: E402,F401 — register config metadata
from app.domain.scheduling import models as scheduling_models  # noqa: E402,F401 — register scheduling metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
