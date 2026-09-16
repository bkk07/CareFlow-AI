"""Voice transport: WebSocket route mounting the voice loop."""

from fastapi import APIRouter, WebSocket

from app.voice.telephony.media_stream_handler import handle_media_stream
from app.voice.web_voice.ws_handler import handle_voice_socket

router = APIRouter(tags=["voice"])


@router.websocket("/voice/ws")
async def voice_ws(
    websocket: WebSocket, token: str | None = None, resume: str | None = None
) -> None:
    await handle_voice_socket(websocket, token, resume)


@router.websocket("/voice/telephony/media")
async def telephony_media(websocket: WebSocket) -> None:
    await handle_media_stream(websocket)


__all__ = ["router"]
