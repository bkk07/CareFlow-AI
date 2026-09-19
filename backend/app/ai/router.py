"""Text chat endpoint (dev-facing in Phase 9; ChatDebug page calls this)."""

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.agent.orchestrator import AINotConfiguredError, run_conversation
from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.observability.tracing import span

router = APIRouter(tags=["chat"])

_chatter = require_role(Role.patient, Role.hospital_admin)


class ChatIn(BaseModel):
    message: str
    conversation_id: str | None = None


class DoctorCardOut(BaseModel):
    id: str
    name: str
    photo_url: str | None = None
    hospital_name: str
    hospital_city: str | None = None
    specialty: str | None = None


class ChatOut(BaseModel):
    conversation_id: str
    reply: str
    iterations: int
    escalated: bool
    stopped: bool = False
    doctors: list[DoctorCardOut] = []


@router.post("/chat", response_model=ChatOut)
def chat(
    body: ChatIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_chatter),
) -> ChatOut:
    # The turn span is the "AI latency" signal: one audit row per
    # request carrying the turn's correlation, duration, and outcome.
    with span(
        db, "chat.turn", conversation_id=body.conversation_id
    ) as info:
        try:
            result = run_conversation(
                db=db,
                ctx=ctx,
                conversation_id=body.conversation_id,
                user_message=body.message,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
            ) from exc
        except AINotConfiguredError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
            ) from exc
        except Exception as exc:
            # Model-backend trouble (auth, network, bad response) is a vendor
            # failure, not a crash: report 502 like the EHR path does.
            if isinstance(exc, httpx.HTTPError):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Model backend error: {exc}",
                ) from exc
            raise
        info["iterations"] = result.get("iterations")
        info["escalated"] = result.get("escalated")
        info["stopped"] = result.get("stopped")
    return ChatOut(**result)


__all__ = ["router"]
