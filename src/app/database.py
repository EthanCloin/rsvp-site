import os
import sqlite3
from datetime import datetime, timezone

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS rsvps (
  id           INTEGER PRIMARY KEY,
  event_id     TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  created_at   TEXT    NOT NULL   -- ISO 8601 UTC, e.g. 2026-10-01T14:03:00Z
);
CREATE INDEX IF NOT EXISTS rsvps_event_id ON rsvps (event_id);
"""


def get_db():
    # 'g' is a flask object generated on each unique request.
    # if a single request hits the db multiple times, it would reuse the
    # db already present in 'g'
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["RSVP_DB_PATH"])
        g.db.row_factory = sqlite3.Row

    return g.db


def close_db(e=None):
    db = g.pop("db", None)

    if db is not None:
        db.close()


def ensure_schema(app):
    """Create the rsvps table and index if they do not exist. Safe to run every start."""
    with app.app_context():
        get_db().executescript(SCHEMA)
    # A read-only file (wrong owner after a restore, say) would otherwise start
    # fine and fail on the first POST. Say so at startup, in the journal.
    path = app.config["RSVP_DB_PATH"]
    if not os.access(path, os.W_OK) or not os.access(os.path.dirname(path), os.W_OK):
        raise RuntimeError(f"database {path} (or its directory) is not writable by this user")


def utcnow_iso():
    """ISO 8601 UTC with a trailing Z, e.g. 2026-10-01T14:03:00Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def init_app(app):
    app.teardown_appcontext(close_db)
    ensure_schema(app)
