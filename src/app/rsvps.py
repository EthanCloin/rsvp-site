import re
import unicodedata

from flask import Blueprint, jsonify, request

from app import events
from app.database import get_db, utcnow_iso

bp = Blueprint("rsvps", __name__, url_prefix="/api")

MAX_NAME_LENGTH = 40

# any run of Unicode whitespace
_WHITESPACE_RE = re.compile(r"\s+")


def error(status, code, message):
    return jsonify(error=code, message=message), status


def unknown_event(event_id):
    return error(404, "unknown_event", f"There is no event with id {event_id!r}.")


@bp.get("/health")
def health():
    return jsonify(ok=True)


@bp.get("/events/<event_id>/rsvps")
def list_rsvps(event_id):
    if event_id not in events.known_event_ids():
        return unknown_event(event_id)

    rows = (
        get_db()
        .execute(
            "SELECT display_name, created_at FROM rsvps"
            " WHERE event_id = ? ORDER BY created_at, id",
            (event_id,),
        )
        .fetchall()
    )
    return jsonify(event_id=event_id, count=len(rows), rsvps=[dict(r) for r in rows])


@bp.post("/events/<event_id>/rsvps")
def create_rsvp(event_id):
    if event_id not in events.known_event_ids():
        return unknown_event(event_id)

    # reading the body is what enforces MAX_CONTENT_LENGTH (413), whatever the
    # content type; get_json() would skip the read for a non-JSON content type
    request.get_data()
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return error(400, "invalid_json", "The request body must be a JSON object.")

    name = body.get("display_name")

    # honeypot: browsers never fill `website`. pretend it worked, store nothing.
    if body.get("website"):
        if isinstance(name, str):
            name = normalise_name(name)
        return jsonify(event_id=event_id, display_name=name, created_at=utcnow_iso()), 201

    # 1. must be a string
    if not isinstance(name, str):
        return error(400, "invalid_name", "display_name must be a string.")

    # 2. trim, collapse internal whitespace
    name = normalise_name(name)

    # 3. empty or too long
    if not name:
        return error(400, "invalid_name", "Please enter a name.")
    if len(name) > MAX_NAME_LENGTH:
        return error(
            400, "invalid_name", f"Names can be at most {MAX_NAME_LENGTH} characters."
        )

    # 4. control characters
    if any(unicodedata.category(c) == "Cc" for c in name):
        return error(400, "invalid_name", "Names cannot contain control characters.")

    # 5. duplicate, case-insensitive. SQLite's lower() is ASCII-only, so compare
    # in Python. BEGIN IMMEDIATE holds the write lock across check + insert so
    # two workers cannot both pass the check.
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    existing = db.execute(
        "SELECT display_name FROM rsvps WHERE event_id = ?", (event_id,)
    ).fetchall()
    wanted = name.casefold()
    if any(row["display_name"].casefold() == wanted for row in existing):
        db.rollback()
        return error(409, "duplicate", "That name is already on the list for this event.")

    created_at = utcnow_iso()
    db.execute(
        "INSERT INTO rsvps (event_id, display_name, created_at) VALUES (?, ?, ?)",
        (event_id, name, created_at),
    )
    db.commit()

    return jsonify(event_id=event_id, display_name=name, created_at=created_at), 201


def normalise_name(name):
    """Strip, then collapse any run of Unicode whitespace to a single space."""
    return _WHITESPACE_RE.sub(" ", name.strip())
