"""FastAPI entry point for Vetřelčí stanice."""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.types import Scope
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import Score

LOGGER = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
VERSION_JSON = STATIC_DIR / "version.json"
APP_NAME = os.getenv("APP_NAME", "Vetřelčí stanice")


class NoCacheStaticFiles(StaticFiles):
    """Serve static assets with revalidation so deploys never mix ES module versions."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


def _positive_env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
        return value if value > 0 else default
    except ValueError:
        LOGGER.warning("Invalid %s value; using %s", name, default)
        return default


SCORE_MAX = _positive_env_int("SCORE_MAX", 1_000_000)


def _load_version() -> str:
    try:
        data = json.loads(VERSION_JSON.read_text(encoding="utf-8"))
        version = data.get("version")
        return str(version) if version else "v.unknown"
    except (OSError, json.JSONDecodeError, TypeError):
        LOGGER.warning("Could not load application version from %s", VERSION_JSON)
        return "v.unknown"


APP_VERSION = _load_version()
templates = Jinja2Templates(directory=BASE_DIR / "templates")
templates.env.globals.update(app_name=APP_NAME, app_version=APP_VERSION)


class ScoreCreate(BaseModel):
    """Strict public payload accepted by the score endpoint."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=20)
    score: int = Field(ge=0)
    level: int = Field(ge=1, le=9)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Jméno nesmí být prázdné.")
        if any(ord(character) < 32 for character in value):
            raise ValueError("Jméno obsahuje nepovolené řídicí znaky.")
        return value.strip()


class ScoreCreated(BaseModel):
    id: int
    name: str
    score: int
    level: int


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=APP_NAME,
    docs_url="/api/docs",
    redoc_url=None,
    lifespan=lifespan,
)
app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")


def _top_scores(db: Session) -> list[Score]:
    query = select(Score).order_by(Score.score.desc(), Score.created_at.asc()).limit(10)
    return list(db.scalars(query))


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"app_name": APP_NAME},
    )


@app.get("/partials/leaderboard", response_class=HTMLResponse)
def leaderboard(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request,
        name="partials/leaderboard.html",
        context={"scores": _top_scores(db)},
    )


@app.post(
    "/api/scores",
    response_model=ScoreCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_score(
    payload: ScoreCreate,
    db: Annotated[Session, Depends(get_db)],
) -> Score:
    if payload.score > SCORE_MAX:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Skóre překračuje povolený limit {SCORE_MAX}.",
        )

    score = Score(name=payload.name, score=payload.score, level=payload.level)
    try:
        db.add(score)
        db.commit()
        db.refresh(score)
    except SQLAlchemyError as exc:
        db.rollback()
        LOGGER.exception("Failed to persist score")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Výsledek se nyní nepodařilo uložit.",
        ) from exc
    return score
