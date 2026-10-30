from samaya.monitoring.ordering import TurnOrdering
from samaya.store import Store


def test_sort_clock_is_seeded_once_and_moves_once_per_turn(tmp_path):
    store = Store(tmp_path)
    ordering = TurnOrdering(store)
    record = {"thread": {"id": "a", "recencyAt": 100}}
    ordering.seed([record])
    record["thread"]["recencyAt"] = 900
    ordering.seed([record])
    assert ordering.values["a"] == 100

    def start(turn, at):
        return {
            "method": "turn/started",
            "params": {"threadId": "a", "turn": {"id": turn, "startedAt": at}},
        }

    ordering.event(start("first", 200))
    for method in (
        "item/agentMessage/delta",
        "item/completed",
        "turn/completed",
        "thread/settings/updated",
    ):
        ordering.event({"method": method, "params": {"threadId": "a"}})
    assert ordering.values["a"] == 200
    ordering.event(start("first", 800))
    assert ordering.values["a"] == 200
    ordering.event(start("second", 300))
    ordering.event(start("late-old", 150))
    assert ordering.values["a"] == 300
    store.close()
    store = Store(tmp_path)
    try:
        ordering = TurnOrdering(store)
        ordering.event(start("first", 999))
        assert ordering.values["a"] == 300
        record["turn"] = {"id": "offline-start", "startedAt": 400}
        ordering.seed([record])
        assert ordering.values["a"] == 400
        record["thread"]["recencyAt"] = 1200
        ordering.seed([record])
        assert ordering.values["a"] == 400
    finally:
        store.close()
