"""Version-pinned SDK compatibility boundary. No protocol requests in routes.

0.160.0 lacks a public external-daemon transport, raw request API and async
approval hook on AsyncCodex. Only this module accesses its private client.
"""

from __future__ import annotations

import sys

from openai_codex import AsyncCodex, CodexConfig
from pydantic import BaseModel, ConfigDict


class ProtocolObject(BaseModel):
    model_config = ConfigDict(extra="allow")


class Adapter:
    def __init__(self, socket: str):
        self.sdk = AsyncCodex(
            CodexConfig(
                launch_args_override=(
                    sys.executable,
                    "-m",
                    "samaya.codex.bridge",
                    socket,
                ),
                client_name="samaya",
                client_title="Samaya",
                client_version="0.1.0",
                experimental_api=True,
            )
        )

    async def start(self) -> None:
        await self.sdk.__aenter__()

    async def close(self) -> None:
        await self.sdk.close()

    async def request(self, method: str, params: dict | None = None) -> dict:
        client = self.sdk._client
        params = params or {}
        if method == "turn/start":
            response = await client.turn_start(params["threadId"], params["input"])
            client.unregister_turn_notifications(response.turn.id)
            return response.model_dump(mode="json", by_alias=True)
        if method == "turn/steer":
            response = await client.turn_steer(
                params["threadId"], params["expectedTurnId"], params["input"]
            )
            return response.model_dump(mode="json", by_alias=True)
        if method == "turn/interrupt":
            response = await client.turn_interrupt(params["threadId"], params["turnId"])
            return response.model_dump(mode="json", by_alias=True)
        if method == "thread/name/set":
            response = await client.thread_set_name(params["threadId"], params["name"])
            return response.model_dump(mode="json", by_alias=True)
        response = await client.request(method, params, response_model=ProtocolObject)
        return response.model_dump(by_alias=True)

    async def event(self) -> dict:
        notification = await self.sdk._client.next_notification()
        if notification.method != "samaya/event":
            raise RuntimeError("Unexpected SDK transport notification")
        return notification.payload.params
