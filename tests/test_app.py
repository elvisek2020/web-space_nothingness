from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

_test_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_test_db.close()
os.environ["DB_PATH"] = _test_db.name
os.environ["SCORE_MAX"] = "5000"

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import APP_VERSION, app  # noqa: E402
from app.models import Score  # noqa: E402


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        session.execute(delete(Score))
        session.commit()
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_index_contains_shell_and_version(client: TestClient):
    response = client.get("/")
    assert response.status_code == 200
    assert 'id="login-screen"' in response.text
    assert f"Verze {APP_VERSION}" in response.text


def test_score_validation_and_trimming(client: TestClient):
    response = client.post(
        "/api/scores",
        json={"name": "  Ripley  ", "score": 1250, "level": 4},
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Ripley"
    with SessionLocal() as session:
        saved = session.scalar(select(Score).where(Score.name == "Ripley"))
        assert saved is not None
        assert saved.score == 1250
        assert saved.level == 4

    assert client.post(
        "/api/scores",
        json={"name": " ", "score": 1, "level": 1},
    ).status_code == 422


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"name": "A", "score": 0, "level": 1}, 201),
        ({"name": "X" * 20, "score": 5000, "level": 4}, 201),
        ({"name": "X" * 21, "score": 1, "level": 1}, 422),
        ({"name": "Rip\nley", "score": 1, "level": 1}, 422),
        ({"name": "Ripley", "score": -1, "level": 1}, 422),
        ({"name": "Ripley", "score": 1.5, "level": 1}, 422),
        ({"name": "Ripley", "score": 1, "level": 0}, 422),
        ({"name": "Ripley", "score": 1, "level": 1, "admin": True}, 422),
    ],
)
def test_score_boundary_validation(client: TestClient, payload: dict, expected: int):
    assert client.post("/api/scores", json=payload).status_code == expected


def test_database_contains_only_accepted_scores(client: TestClient):
    accepted = [
        {"name": "Dallas", "score": 10, "level": 1},
        {"name": "Lambert", "score": 20, "level": 2},
    ]
    for payload in accepted:
        assert client.post("/api/scores", json=payload).status_code == 201
    assert client.post(
        "/api/scores",
        json={"name": "", "score": 99, "level": 1},
    ).status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Score)) == len(accepted)
    assert client.post(
        "/api/scores",
        json={"name": "Ash", "score": 5001, "level": 1},
    ).status_code == 422
    assert client.post(
        "/api/scores",
        json={"name": "Ash", "score": 2, "level": 10},
    ).status_code == 422
    assert client.post(
        "/api/scores",
        json={"name": "Ripley", "score": 900, "level": 9},
    ).status_code == 201


def test_leaderboard_is_sorted_limited_and_escaped(client: TestClient):
    for index in range(12):
        name = "<script>alert(1)</script>" if index == 11 else f"Hráč {index}"
        response = client.post(
            "/api/scores",
            json={"name": name[:20], "score": index * 100, "level": 2},
        )
        assert response.status_code == 201

    response = client.get("/partials/leaderboard")
    assert response.status_code == 200
    assert response.text.count("<tr>") == 11  # header + top ten
    assert "1100" in response.text
    assert "Hráč 0" not in response.text
    assert "<script>" not in response.text
    assert "&lt;script&gt;" in response.text


def test_static_assets_send_no_cache_and_index_versions_urls(client: TestClient):
    index = client.get("/")
    assert index.status_code == 200
    assert f"?v={APP_VERSION}" in index.text
    assert "js/main.js" in index.text
    assert "css/game.css" in index.text

    response = client.get("/static/css/game.css")
    assert response.status_code == 200
    assert response.headers.get("cache-control") == "no-cache"


def teardown_module():
    engine.dispose()
    Path(_test_db.name).unlink(missing_ok=True)
