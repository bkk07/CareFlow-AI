"""MCP server: capability tools the AI agent (Phase 9) may call.

Each tool wraps an existing domain service with the `mcp_tool` decorator
(auth + idempotency + audit + bounded retry). Tools are callable
in-process via `server.execute_tool` and over HTTP via `server.router`.
"""
