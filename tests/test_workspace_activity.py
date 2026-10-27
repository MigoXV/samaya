from samaya.config import Settings
from samaya.monitoring.activity import activity_thread
from samaya.runtime import Runtime
from samaya.store import Store


def test_activity_excludes_browsing_and_polling():
    for method in (
        "thread/started",
        "thread/status/changed",
        "thread/settings/updated",
        "thread/tokenUsage/updated",
        "samaya/connection",
        "app/list/updated",
    ):
        assert activity_thread({"method": method, "params": {"threadId": "a"}}) is None
    for method in (
        "turn/started",
        "turn/completed",
        "turn/plan/updated",
        "item/started",
        "item/completed",
        "item/agentMessage/delta",
        "item/reasoning/summaryTextDelta",
    ):
        assert activity_thread({"method": method, "params": {"threadId": "a"}}) == "a"
    assert (
        activity_thread(
            {
                "id": 7,
                "method": "item/tool/requestUserInput",
                "params": {"threadId": "a"},
            }
        )
        == "a"
    )
    assert (
        activity_thread(
            {
                "id": 8,
                "method": "mcpServer/elicitation/request",
                "params": {"threadId": "a"},
            }
        )
        == "a"
    )


async def test_activity_survives_restart_and_deltas_use_existing_patch(tmp_path):
    store = Store(tmp_path)
    runtime = Runtime(Settings(data_dir=tmp_path), store)
    runtime.monitor.projection.records["a"] = {"thread": {"id": "a", "cwd": "/project"}}
    await runtime.publish(
        {
            "method": "item/agentMessage/delta",
            "params": {"threadId": "a", "delta": "hello"},
        }
    )
    first = runtime.monitor.snapshot()["records"][0]
    assert first["lastActivityId"] == store.cursor()
    assert "a" in runtime.monitor.projection.dirty
    assert not runtime.monitor.projection.refresh_queue
    await runtime.publish(
        {"method": "thread/settings/updated", "params": {"threadId": "a"}}
    )
    assert (
        runtime.monitor.snapshot()["records"][0]["lastActivityId"]
        == first["lastActivityId"]
    )
    store.close()
    store = Store(tmp_path)
    try:
        second = Runtime(Settings(data_dir=tmp_path), store)
        second.monitor.projection.records["a"] = {
            "thread": {"id": "a", "cwd": "/project"}
        }
        assert (
            second.monitor.snapshot()["records"][0]["lastActivityId"]
            == first["lastActivityId"]
        )
        await second.publish(
            {
                "method": "item/agentMessage/delta",
                "params": {"threadId": "a", "delta": "new"},
            }
        )
        assert (
            second.monitor.snapshot()["records"][0]["lastActivityId"]
            > first["lastActivityId"]
        )
    finally:
        store.close()
