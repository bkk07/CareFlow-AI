"""FastAPI application entrypoint (Phase 0 — Scaffolding)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import settings
from app.domain.auth.router import router as auth_router
from app.domain.doctor.router import router as doctor_router
from app.domain.hospital.router import router as hospital_router
from app.domain.hospital_config.router import router as hospital_config_router
from app.domain.scheduling.router import router as scheduling_router

app = FastAPI(title="CareFlow AI", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(hospital_router)
app.include_router(hospital_config_router)
app.include_router(doctor_router)
app.include_router(scheduling_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "careflow-ai", "status": "ok"}
