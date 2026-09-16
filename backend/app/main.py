"""FastAPI application entrypoint (Phase 0 — Scaffolding)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import settings
from app.domain.auth.router import router as auth_router
from app.domain.appointment.router import router as appointment_router
from app.domain.doctor.router import router as doctor_router
from app.domain.hospital.router import router as hospital_router
from app.domain.hospital_config.router import router as hospital_config_router
from app.domain.patient.router import router as patient_router
from app.domain.scheduling.router import router as scheduling_router
from app.integration.mock_ehr.router import router as mock_ehr_router
from app.ai.router import router as chat_router
from app.mcp_server.server import router as mcp_router
from app.reliability.router import router as reliability_router

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
app.include_router(appointment_router)
app.include_router(hospital_router)
app.include_router(hospital_config_router)
app.include_router(doctor_router)
app.include_router(patient_router)
app.include_router(scheduling_router)
app.include_router(mock_ehr_router)
app.include_router(mcp_router)
app.include_router(chat_router)
app.include_router(reliability_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "careflow-ai", "status": "ok"}
