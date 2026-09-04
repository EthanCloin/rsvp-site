import json
import secrets
import unicodedata

from flask import Blueprint, current_app, jsonify, request

from app import events
from app.database import get_db, utcnow_iso

bp = Blueprint("rsvps", __name__, url_prefix="/api")

MAX_NAME_LENGTH = 40
DEFAULT_MAX_RSVPS_PER_EVENT = 500

# Characters treated as whitespace for trimming and collapsing: ASCII
# whitespace plus the Unicode separator categories (Zs, Zl, Zp). Deliberately
# not str.isspace()/\s, which also match the C0 controls 1C-1F and NEL (U+0085)
# and would launder them past the control-character check below.
_ASCII_WS = set(" \t\n\r\f\v")

# Rejected outright: controls (Cc), format chars such as zero-width space and
# bidi overrides (Cf), surrogates, private use, unassigned. ZWJ is allowed so
# emoji sequences like a family or a flag keep working.
_REJECTED_CATEGORIES = {"Cc", "Cf", "Cs", "Co", "Cn"}
_ALLOWED_FORMAT_CHARS = {"\u200d"}  # zero width joiner


TOKEN_BYTES = 24  # secrets.token_urlsafe(24) -> 32 url-safe characters


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

    body = read_json_object()
    if body is None:
        return error(400, "invalid_json", "The request body must be a JSON object.")

    name = body.get("display_name")

    # honeypot: browsers never fill `website`. pretend it worked, store nothing.
    website = body.get("website")
    if website is not None and website != "":
        echoed = normalise_name(name) if isinstance(name, str) else ""
        # Same shape as a real 201, throwaway token: a bot cannot tell it stored
        # nothing. The id is 0, which no row ever has (INTEGER PRIMARY KEY starts at 1).
        return (
            jsonify(
                event_id=event_id,
                rsvp_id=0,
                display_name=echoed,
                created_at=utcnow_iso(),
                token=secrets.token_urlsafe(TOKEN_BYTES),
            ),
            201,
        )

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

    # 4. control, format, and other invisible characters
    if any(_is_rejected_char(c) for c in name):
        return error(400, "invalid_name", "Names cannot contain invisible or control characters.")

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

    # 6. per-event cap, so one bored visitor cannot make the page unbounded
    max_per_event = current_app.config.get("RSVP_MAX_PER_EVENT", DEFAULT_MAX_RSVPS_PER_EVENT)
    if len(existing) >= max_per_event:
        db.rollback()
        return error(409, "event_full", "This list is full.")

    created_at = utcnow_iso()
    # The token goes back to this browser once and is never listed again. It is
    # the only thing that lets a visitor delete their own name later.
    token = secrets.token_urlsafe(TOKEN_BYTES)
    cur = db.execute(
        "INSERT INTO rsvps (event_id, display_name, created_at, token) VALUES (?, ?, ?, ?)",
        (event_id, name, created_at, token),
    )
    rsvp_id = cur.lastrowid
    db.commit()

    return (
        jsonify(
            event_id=event_id,
            rsvp_id=rsvp_id,
            display_name=name,
            created_at=created_at,
            token=token,
        ),
        201,
    )


@bp.delete("/events/<event_id>/rsvps/<int:rsvp_id>")
def delete_rsvp(event_id, rsvp_id):
    """
    Remove one RSVP for whoever holds its token. This is the whole "I changed my
    mind" story: no account, no password, just the secret the browser kept from
    the POST. Removing someone else's name is still a job for sqlite3 on the box.
    """
    if event_id not in events.known_event_ids():
        return unknown_event(event_id)

    body = read_json_object()
    if body is None:
        return error(400, "invalid_json", "The request body must be a JSON object.")
    token = body.get("token")
    if not isinstance(token, str) or not token:
        return error(400, "invalid_json", "A token is required.")

    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    row = db.execute(
        "SELECT display_name, token FROM rsvps WHERE id = ? AND event_id = ?",
        (rsvp_id, event_id),
    ).fetchone()
    if row is None:
        db.rollback()
        return error(404, "not_found", "That RSVP is not on this list.")

    # compare_digest on a fixed-length stand-in when the row predates tokens, so
    # a NULL token takes the same path (and the same time) as a wrong one.
    stored = row["token"] or ""
    if not secrets.compare_digest(stored, token):
        db.rollback()
        return error(403, "invalid_token", "That RSVP belongs to someone else.")

    db.execute("DELETE FROM rsvps WHERE id = ?", (rsvp_id,))
    db.commit()
    return jsonify(
        event_id=event_id, rsvp_id=rsvp_id, display_name=row["display_name"], deleted=True
    )


def read_json_object():
    """
    The request body as a dict, or None if it is not a JSON object.

    Reading the body is what enforces MAX_CONTENT_LENGTH (413), whatever the
    content type. Parsed by hand rather than get_json(): deeply nested junk like
    1000 "[" raises RecursionError, which get_json(silent=True) does not swallow.
    """
    raw = request.get_data()
    if not request.is_json:
        return None
    try:
        body = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    return body if isinstance(body, dict) else None


def _is_whitespace(c):
    return c in _ASCII_WS or unicodedata.category(c).startswith("Z")


def _is_rejected_char(c):
    if c in _ALLOWED_FORMAT_CHARS:
        return False
    return unicodedata.category(c) in _REJECTED_CATEGORIES


def normalise_name(name):
    """
    NFC-normalise, strip, then collapse any run of whitespace (see _is_whitespace)
    to a single space. NFC means "José" typed as e + combining accent and as the
    precomposed é compare equal for the duplicate check.
    """
    name = unicodedata.normalize("NFC", name)
    out = []
    in_space = False
    for c in name:
        if _is_whitespace(c):
            in_space = True
            continue
        if in_space and out:
            out.append(" ")
        in_space = False
        out.append(c)
    return "".join(out)
