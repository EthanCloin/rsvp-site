"""Regression tests for the issues found in code review."""
import json

import pytest

from app import create_app, events

URL = "/api/events/fri-dinner/rsvps"


def post(client, **body):
    return client.post(URL, json=body)


def test_deeply_nested_json_is_400_not_500(client):
    res = client.post(URL, data="[" * 1000, content_type="application/json")
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid_json"


@pytest.mark.parametrize(
    "bad",
    [
        "Sam\x1fJones",  # C0 control that \s would have collapsed
        "Sam\x85Jones",  # NEL, same
        "Sam​Jones",  # zero width space (Cf)
        "Sam﻿Jones",  # BOM (Cf)
        "Sam‮Jones",  # right-to-left override (Cf)
    ],
)
def test_invisible_characters_rejected(client, bad):
    res = post(client, display_name=bad)
    assert res.status_code == 400, res.get_json()
    assert res.get_json()["error"] == "invalid_name"


def test_zwj_emoji_sequence_allowed(client):
    family = "Sam \U0001f468‍\U0001f469‍\U0001f467"
    res = post(client, display_name=family)
    assert res.status_code == 201
    assert res.get_json()["display_name"] == family


def test_unicode_separator_still_collapsed(client):
    res = post(client, display_name="Sam  Jones")
    assert res.status_code == 201
    assert res.get_json()["display_name"] == "Sam Jones"


def test_nfc_and_nfd_are_duplicates(client):
    assert post(client, display_name="José").status_code == 201
    res = post(client, display_name="José")
    assert res.status_code == 409
    assert res.get_json()["error"] == "duplicate"


def test_per_event_cap(tmp_path, events_path):
    app = create_app(
        {
            "TESTING": True,
            "RSVP_DB_PATH": str(tmp_path / "cap.db"),
            "RSVP_EVENTS_PATH": str(events_path),
            "RSVP_MAX_PER_EVENT": 2,
        }
    )
    client = app.test_client()
    assert post(client, display_name="One").status_code == 201
    assert post(client, display_name="Two").status_code == 201
    res = post(client, display_name="Three")
    assert res.status_code == 409
    assert res.get_json()["error"] == "event_full"
    # a duplicate is still reported as a duplicate, and other events are unaffected
    assert post(client, display_name="one").get_json()["error"] == "duplicate"
    assert client.post("/api/events/sat-coffee/rsvps", json={"display_name": "Three"}).status_code == 201


def test_unknown_api_get_is_json_404(client):
    res = client.get("/api/nope")
    assert res.status_code == 404
    assert res.get_json()["error"] == "not_found"


@pytest.mark.parametrize("method", ["post", "put", "delete"])
def test_unknown_api_other_methods_are_json_405(client, method):
    res = getattr(client, method)("/api/nope")
    assert res.status_code == 405
    assert res.get_json()["error"] == "method_not_allowed"


def test_honeypot_echo_is_always_a_string(client):
    res = post(client, website="x", display_name={"a": [1]})
    assert res.status_code == 201
    assert res.get_json()["display_name"] == ""
    res = post(client, website=0, display_name="Bot")  # non-string but present
    assert res.status_code == 201
    assert client.get(URL).get_json()["count"] == 0


def test_missing_file_after_load_keeps_last_good_list(app, events_path, caplog):
    with app.app_context():
        assert events.known_event_ids() == {"fri-dinner", "sat-coffee"}
        events_path.unlink()
        assert events.known_event_ids() == {"fri-dinner", "sat-coffee"}
        assert events.known_event_ids() == {"fri-dinner", "sat-coffee"}
    assert caplog.text.count("cannot stat events file") == 1


def test_bad_json_logged_once_not_per_request(app, events_path, caplog):
    with app.app_context():
        events.known_event_ids()
        events_path.write_text("{not json")
        import os
        st = os.stat(events_path)
        os.utime(events_path, ns=(st.st_atime_ns, st.st_mtime_ns + 10_000_000))
        for _ in range(3):
            assert events.known_event_ids() == {"fri-dinner", "sat-coffee"}
    assert caplog.text.count("cannot load events file") == 1
