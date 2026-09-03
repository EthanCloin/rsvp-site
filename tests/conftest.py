import json

import pytest

from app import create_app

EVENT_IDS = ["fri-dinner", "sat-coffee"]


def write_events(path, ids):
    events = [{"id": event_id, "title": event_id, "start": "2026-10-09T19:00:00-04:00"} for event_id in ids]
    path.write_text(json.dumps({"title": "t", "intro": "i", "events": events}))


@pytest.fixture
def events_path(tmp_path):
    path = tmp_path / "events.json"
    write_events(path, EVENT_IDS)
    return path


@pytest.fixture
def app(tmp_path, events_path):
    return create_app(
        {
            "TESTING": True,
            "RSVP_DB_PATH": str(tmp_path / "rsvps.db"),
            "RSVP_EVENTS_PATH": str(events_path),
        }
    )


@pytest.fixture
def client(app):
    return app.test_client()
