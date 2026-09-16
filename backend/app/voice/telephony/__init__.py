"""Telephony package: Twilio inbound voice reusing the Phase 12 pipeline.

Submodules are imported directly (never eagerly here) so the MCP tool
registry can load `identity` without pulling the media handler's
orchestrator import into a cycle.
"""

__all__: list[str] = []
