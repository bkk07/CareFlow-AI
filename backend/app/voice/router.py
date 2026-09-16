"""Voice transport: WebSocket route mounting the voice loop."""

from fastapi import APIRouter, WebSocket

from app.voice.web_voice.ws_handler import handle_voice_socket

router = APIRouter(tags=["voice"])


@router.websocket("/voice/ws")
async def voice_ws(
    websocket: WebSocket, token: str | None = None, resume: str | None = None
) -> None:
    await handle_voice_socket(websocket, token, resume)


__all__ = ["router"]
