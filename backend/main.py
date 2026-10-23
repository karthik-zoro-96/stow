from __future__ import annotations

import base64
import binascii
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PHOTO_DIR = DATA_DIR / "photos"
DB_PATH = DATA_DIR / "stow.sqlite3"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("STOW_MODEL", "gemma3:4b")
MAX_IMAGE_BYTES = 7 * 1024 * 1024

DATA_DIR.mkdir(exist_ok=True)
PHOTO_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Stow local API", docs_url=None, redoc_url=None)


@contextmanager
def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    with db() as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            location TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            photo_path TEXT,
            created_at TEXT NOT NULL
        )""")


init_db()


class RememberRequest(BaseModel):
    note: str = Field(min_length=3, max_length=1000)
    image: str | None = None


class FindRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)


def ollama_chat(messages: list[dict[str, Any]], *, format_json: bool = False) -> str:
    payload: dict[str, Any] = {
        "model": MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.1},
    }
    if format_json:
        payload["format"] = "json"
    request = Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            result = json.loads(response.read())
        return result["message"]["content"]
    except (URLError, TimeoutError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach local Ollama. Start Ollama and pull {MODEL}.",
        ) from exc


def memory_json(row: sqlite3.Row) -> dict[str, Any]:
    photo_path = row["photo_path"]
    return {
        "id": row["id"], "name": row["name"], "location": row["location"],
        "note": row["note"], "created_at": row["created_at"],
        "photo_url": f"/photos/{Path(photo_path).name}" if photo_path else None,
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        request = Request(f"{OLLAMA_URL}/api/tags", method="GET")
        with urlopen(request, timeout=2) as response:
            tags = json.loads(response.read()).get("models", [])
        available = any(model.get("name") == MODEL for model in tags)
        return {"ok": True, "model_available": available, "model": MODEL}
    except (URLError, TimeoutError, json.JSONDecodeError):
        return {"ok": False, "model_available": False, "model": MODEL}


@app.get("/api/memories")
def list_memories() -> list[dict[str, Any]]:
    with db() as connection:
        rows = connection.execute("SELECT * FROM memories ORDER BY created_at DESC").fetchall()
    return [memory_json(row) for row in rows]


@app.post("/api/memories")
def save_memory(body: RememberRequest) -> dict[str, Any]:
    if body.image:
        try:
            image_bytes = base64.b64decode(body.image, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=400, detail="That photo could not be read.") from exc
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Photo is too large. Try a smaller image.")
    else:
        image_bytes = None

    prompt = (
        "Extract one household item memory from the user's note and optional image. "
        "Return JSON with keys name, location, note. name is a concise item name. "
        "location must come only from the user's words; never invent or guess a location. "
        "If no location is stated, return an empty location. note should preserve useful identifying details, "
        "not add facts. Use the image only to help identify the item, never its location."
    )
    message: dict[str, Any] = {"role": "user", "content": body.note}
    if image_bytes is not None:
        message["images"] = [base64.b64encode(image_bytes).decode("ascii")]
    content = ollama_chat([{"role": "system", "content": prompt}, message], format_json=True)
    try:
        parsed = json.loads(content)
        name = str(parsed.get("name", "")).strip()[:120]
        location = str(parsed.get("location", "")).strip()[:300]
        note = str(parsed.get("note", "")).strip()[:500]
    except (json.JSONDecodeError, AttributeError) as exc:
        raise HTTPException(status_code=502, detail="The local model returned an unreadable result. Try again.") from exc
    if not name or not location:
        raise HTTPException(status_code=422, detail="I couldn't find both the item and its location. Add where you put it and try again.")

    memory_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    photo_path = None
    if image_bytes is not None:
        photo_path = PHOTO_DIR / f"{memory_id}.jpg"
        photo_path.write_bytes(image_bytes)
    with db() as connection:
        connection.execute(
            "INSERT INTO memories (id, name, location, note, photo_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (memory_id, name, location, note, str(photo_path) if photo_path else None, created_at),
        )
        row = connection.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
    return memory_json(row)


@app.post("/api/find")
def find_memory(body: FindRequest) -> dict[str, Any]:
    with db() as connection:
        rows = connection.execute("SELECT * FROM memories ORDER BY created_at DESC LIMIT 200").fetchall()
    if not rows:
        return {"memory": None, "note": "Save your first item memory, then ask me to find it."}

    candidates = rows
    records = [{"id": row["id"], "name": row["name"], "location": row["location"], "note": row["note"]} for row in candidates]
    system = (
        "You match a household question to saved item memories. Choose only a record that is actually supported by the query. "
        "Never invent an item or location. Return JSON only: {\"match_id\": string or null}. "
        "If uncertain, set match_id to null."
    )
    result = ollama_chat([
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps({"query": body.query, "saved_memories": records}, ensure_ascii=False)},
    ], format_json=True)
    try:
        parsed = json.loads(result)
        match_id = parsed.get("match_id")
    except (json.JSONDecodeError, AttributeError) as exc:
        raise HTTPException(status_code=502, detail="The local model returned an unreadable search result. Try again.") from exc
    allowed = {row["id"] for row in candidates}
    if not isinstance(match_id, str) or match_id not in allowed:
        return {"memory": None, "note": "No clear match. Try another name or detail."}
    matched = next(row for row in candidates if row["id"] == match_id)
    return {"memory": memory_json(matched), "note": "Matched to a memory you saved."}


@app.delete("/api/memories/{memory_id}")
def delete_memory(memory_id: str) -> dict[str, bool]:
    with db() as connection:
        row = connection.execute("SELECT photo_path FROM memories WHERE id = ?", (memory_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Memory not found.")
        connection.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    if row["photo_path"]:
        Path(row["photo_path"]).unlink(missing_ok=True)
    return {"ok": True}


app.mount("/photos", StaticFiles(directory=PHOTO_DIR), name="photos")


@app.get("/")
def root() -> FileResponse:
    return FileResponse(ROOT / "dist" / "index.html")
