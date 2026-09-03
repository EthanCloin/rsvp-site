def test_api_404_is_json(client):
    res = client.get("/api/nope")
    assert res.status_code == 404
    body = res.get_json()
    assert body["error"] == "not_found"
    assert isinstance(body["message"], str)


def test_api_405_is_json(client):
    res = client.post("/api/health", json={})
    assert res.status_code == 405
    body = res.get_json()
    assert body["error"] == "method_not_allowed"
    assert isinstance(body["message"], str)


def test_api_413_is_json(client):
    res = client.post(
        "/api/events/fri-dinner/rsvps", data="x" * 2000, content_type="application/json"
    )
    assert res.status_code == 413
    body = res.get_json()
    assert set(body) == {"error", "message"}


def test_api_500_is_json(app):
    app.config["PROPAGATE_EXCEPTIONS"] = False

    @app.get("/api/boom")
    def boom():
        raise RuntimeError("boom")

    res = app.test_client().get("/api/boom")
    assert res.status_code == 500
    body = res.get_json()
    assert body["error"] == "internal_server_error"
    assert isinstance(body["message"], str)


def test_non_api_404_is_not_json(client):
    res = client.get("/definitely-not-here.html")
    assert res.status_code == 404
    assert res.get_json(silent=True) is None
    assert res.mimetype == "text/html"
