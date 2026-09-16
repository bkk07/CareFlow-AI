"""Text chat endpoint (dev-facing in Phase 9; ChatDebug page calls this)."""

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.agent.orchestrator import AINotConfiguredError, run_conversation
from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role

router = APIRouter(tags=["chat"])

_chatter = require_role(Role.patient, Role.hospital_admin)


class ChatIn(BaseModel):
    message: str
    conversation_id: str | None = None


class ChatOut(BaseModel):
    conversation_id: str
    reply: str
    iterations: int
    escalated: bool


@router.post("/chat", response_model=ChatOut)
def chat(
    body: ChatIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_chatter),
) -> ChatOut:
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
    return ChatOut(**result)


__all__ = ["router"]
