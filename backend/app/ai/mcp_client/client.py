"""In-process MCP client: the orchestrator's handle onto the tool registry.

Tool faults never raise here — they come back as error outcomes so the
agent can relay them honestly and offer escalation instead of crashing
the turn.
"""

import json
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.mcp_server import server


class AgentToolClient:
    def __init__(self, db: Session, ctx: RequestContext) -> None:
        self._db = db
        self._ctx = ctx

    def specs(self) -> list[dict[str, Any]]:
        """LLM function specs derived from the registered input models."""
        specs = []
        for name, meta in sorted(server._TOOLS.items()):
            parameters = meta["input_model"].model_json_schema()
            specs.append(
                {
                    "name": name,
                    "description": meta["description"],
                    "parameters": parameters,
                }
            )
        return specs

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            result = server.execute_tool(name, arguments or {}, self._ctx, self._db)
        except HTTPException as exc:
            detail = exc.detail
            return {
                "ok": False,
                "error": detail if isinstance(detail, str) else json.dumps(detail),
                "status_code": exc.status_code,
            }
        except ValidationError as exc:
            return {"ok": False, "error": f"Invalid arguments: {exc.errors()}"}
        except Exception as exc:  # never let a tool crash the turn
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        return {"ok": True, "result": result}

    @staticmethod
    def encode(outcome: dict[str, Any]) -> str:
        try:
            return json.dumps(outcome, default=str)
        except (TypeError, ValueError):
            return str(outcome)


__all__ = ["AgentToolClient"]
