"""
Read events.json (the same file nginx serves to the frontend) to learn which
event ids exist. The file is re-read whenever it changes on disk, so editing it
needs no restart.
"""

import json
import logging
import os
import re
import threading

from flask import current_app

ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")

log = logging.getLogger(__name__)

# path -> (file signature, frozenset of ids)
_cache = {}
_lock = threading.Lock()


def known_event_ids(path=None):
    """The set of valid event ids from events.json, reloading it if it changed."""
    if path is None:
        path = current_app.config["RSVP_EVENTS_PATH"]

    with _lock:
        cached = _cache.get(path)

        # Missing or unreadable (a deploy mid-swap, say): keep the last good
        # list if there is one, log once per change rather than per request.
        try:
            st = os.stat(path)
        except OSError as exc:
            if cached is None or cached[0] is not None:
                log.error("cannot stat events file %s: %s", path, exc)
            ids = cached[1] if cached is not None else frozenset()
            _cache[path] = (None, ids)
            return ids
        signature = (st.st_mtime_ns, st.st_size, st.st_ino)

        if cached is not None and cached[0] == signature:
            return cached[1]

        try:
            ids = _load_ids(path)
        except (OSError, ValueError) as exc:
            log.error("cannot load events file %s: %s", path, exc)
            # keep the last good list, and remember this signature so the
            # broken file is not re-parsed and re-logged on every request
            ids = cached[1] if cached is not None else frozenset()

        _cache[path] = (signature, ids)
        return ids


def _load_ids(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list):
        raise ValueError("expected a JSON object with an 'events' list")

    ids = set()
    for event in events:
        event_id = event.get("id") if isinstance(event, dict) else None
        if not isinstance(event_id, str) or not ID_RE.match(event_id):
            log.warning("skipping event with invalid id %r in %s", event_id, path)
            continue
        if event_id in ids:
            log.warning("duplicate event id %r in %s", event_id, path)
        ids.add(event_id)
    return frozenset(ids)
