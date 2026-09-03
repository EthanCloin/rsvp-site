def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json() == {"ok": True}
