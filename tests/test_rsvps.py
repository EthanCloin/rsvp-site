import json
import re

import pytest

URL = "/api/events/fri-dinner/rsvps"
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def post(client, **body):
    return client.post(URL, json=body)


def names(client, url=URL):
    return [r["display_name"] for r in client.get(url).get_json()["rsvps"]]


def test_get_known_event_empty(client):
    res = client.get(URL)
    assert res.status_code == 200
    assert res.get_json() == {"event_id": "fri-dinner", "count": 0, "rsvps": []}


def test_get_unknown_event(client):
    res = client.get("/api/events/nope/rsvps")
    assert res.status_code == 404
    body = res.get_json()
    assert body["error"] == "unknown_event"
    assert isinstance(body["message"], str)


def test_post_success_then_listed(client):
    res = post(client, display_name="Sam", website="")
    assert res.status_code == 201
    body = res.get_json()
    assert set(body) == {"event_id", "display_name", "created_at"}
    assert body["event_id"] == "fri-dinner"
    assert body["display_name"] == "Sam"
    assert TIMESTAMP_RE.match(body["created_at"])

    res = client.get(URL)
    assert res.status_code == 200
    listed = res.get_json()
    assert listed["count"] == 1
    assert listed["rsvps"] == [{"display_name": "Sam", "created_at": body["created_at"]}]


def test_list_ordered_by_created_at(client):
    for name in ["Alice", "Bob", "Carol"]:
        assert post(client, display_name=name).status_code == 201
    assert names(client) == ["Alice", "Bob", "Carol"]
    assert client.get(URL).get_json()["count"] == 3


def test_post_unknown_event(client):
    res = client.post("/api/events/nope/rsvps", json={"display_name": "Sam"})
    assert res.status_code == 404
    assert res.get_json()["error"] == "unknown_event"


@pytest.mark.parametrize(
    "display_name",
    [
        123,
        None,
        ["Sam"],
        "",
        "   ",
        "\t\n ",
        "a" * 41,
        "  " + "a" * 41 + "  ",
        "Sam\x00Jones",
        "Sam\x07",
        "\x1bSam",
    ],
)
def test_post_invalid_name(client, display_name):
    res = post(client, display_name=display_name)
    assert res.status_code == 400
    body = res.get_json()
    assert body["error"] == "invalid_name"
    assert isinstance(body["message"], str) and body["message"]
    assert names(client) == []


def test_post_missing_display_name(client):
    res = post(client, website="")
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid_name"


def test_40_chars_after_trim_is_ok(client):
    res = post(client, display_name="  " + "a" * 40 + "  ")
    assert res.status_code == 201
    assert res.get_json()["display_name"] == "a" * 40


@pytest.mark.parametrize(
    "raw",
    [
        ["Sam"],
        "just a string",
        42,
        None,
    ],
)
def test_post_non_object_json(client, raw):
    res = client.post(URL, data=json.dumps(raw), content_type="application/json")
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid_json"


def test_post_malformed_json(client):
    res = client.post(URL, data="{not json", content_type="application/json")
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid_json"


def test_post_not_json_content_type(client):
    res = client.post(URL, data="display_name=Sam")
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid_json"


def test_whitespace_collapsed(client):
    res = post(client, display_name="  Sam   Jones ")
    assert res.status_code == 201
    assert res.get_json()["display_name"] == "Sam Jones"
    assert names(client) == ["Sam Jones"]


def test_unicode_whitespace_collapsed(client):
    res = post(client, display_name=" Sam \t　Jones ")
    assert res.status_code == 201
    assert res.get_json()["display_name"] == "Sam Jones"


def test_duplicate_case_insensitive(client):
    assert post(client, display_name="Sam").status_code == 201
    res = post(client, display_name="sam")
    assert res.status_code == 409
    body = res.get_json()
    assert body["error"] == "duplicate"
    assert isinstance(body["message"], str)
    assert names(client) == ["Sam"]


def test_duplicate_after_normalisation(client):
    assert post(client, display_name="Sam Jones").status_code == 201
    assert post(client, display_name="  SAM   jones ").status_code == 409


def test_duplicate_non_ascii_case(client):
    assert post(client, display_name="Straße").status_code == 201
    assert post(client, display_name="STRASSE").status_code == 409


def test_same_name_different_event_allowed(client):
    assert post(client, display_name="Sam").status_code == 201
    res = client.post("/api/events/sat-coffee/rsvps", json={"display_name": "sam"})
    assert res.status_code == 201
    assert names(client) == ["Sam"]
    assert names(client, "/api/events/sat-coffee/rsvps") == ["sam"]


def test_honeypot_returns_201_and_stores_nothing(client):
    res = post(client, display_name="Bot", website="http://spam.example")
    assert res.status_code == 201
    body = res.get_json()
    assert set(body) == {"event_id", "display_name", "created_at"}
    assert body["event_id"] == "fri-dinner"
    assert body["display_name"] == "Bot"
    assert TIMESTAMP_RE.match(body["created_at"])
    assert client.get(URL).get_json() == {"event_id": "fri-dinner", "count": 0, "rsvps": []}


def test_honeypot_empty_is_not_a_bot(client):
    assert post(client, display_name="Sam", website="").status_code == 201
    assert names(client) == ["Sam"]


def test_body_over_1kib_is_413(client):
    big = json.dumps({"display_name": "x" * 1100})
    assert len(big) > 1024
    res = client.post(URL, data=big, content_type="application/json")
    assert res.status_code == 413
    body = res.get_json()
    assert set(body) == {"error", "message"}
    assert names(client) == []


def test_body_at_limit_is_accepted(client):
    body = {"display_name": "Sam", "website": "", "pad": ""}
    body["pad"] = "p" * (1024 - len(json.dumps(body)))
    data = json.dumps(body)
    assert len(data) == 1024
    res = client.post(URL, data=data, content_type="application/json")
    assert res.status_code == 201
