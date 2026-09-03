import json
import os

from app import events
from conftest import write_events


def bump_mtime(path):
    st = os.stat(path)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))


def test_known_ids(app):
    with app.app_context():
        assert events.known_event_ids() == {"fri-dinner", "sat-coffee"}


def test_edit_is_picked_up_without_restart(client, events_path):
    assert client.get("/api/events/mon-lunch/rsvps").status_code == 404

    write_events(events_path, ["fri-dinner", "sat-coffee", "mon-lunch"])
    bump_mtime(events_path)

    assert client.get("/api/events/mon-lunch/rsvps").status_code == 200
    res = client.post("/api/events/mon-lunch/rsvps", json={"display_name": "Sam"})
    assert res.status_code == 201

    write_events(events_path, ["fri-dinner"])
    bump_mtime(events_path)
    assert client.get("/api/events/sat-coffee/rsvps").status_code == 404
    assert client.get("/api/events/fri-dinner/rsvps").status_code == 200


def test_invalid_ids_are_skipped(app, events_path, caplog):
    write_events(events_path, ["ok-id", "Bad Id", "UPPER", "", "a" * 41, "under_score"])
    bump_mtime(events_path)
    with app.app_context():
        assert events.known_event_ids() == {"ok-id"}
    assert "skipping event with invalid id" in caplog.text


def test_malformed_entries_are_skipped(app, events_path):
    events_path.write_text(json.dumps({"events": [{"id": "good"}, {"nope": 1}, "str", {"id": 5}, None]}))
    bump_mtime(events_path)
    with app.app_context():
        assert events.known_event_ids() == {"good"}


def test_bad_json_keeps_last_good_list(app, events_path, caplog):
    with app.app_context():
        assert events.known_event_ids() == {"fri-dinner", "sat-coffee"}
        events_path.write_text("{not json")
        bump_mtime(events_path)
        assert events.known_event_ids() == {"fri-dinner", "sat-coffee"}
    assert "cannot load events file" in caplog.text


def test_missing_file_means_no_events(app, events_path):
    events_path.unlink()
    with app.app_context():
        assert events.known_event_ids() == frozenset()
    assert app.test_client().get("/api/events/fri-dinner/rsvps").status_code == 404
