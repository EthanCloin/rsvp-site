# Contract

Everything below is fixed. Backend, frontend, and ops are built independently
against this file, so change it here first if it has to change.

## Names and paths

| Thing | Value |
| --- | --- |
| Domain | `come-see.ethancloin.xyz` |
| systemd unit | `come-see.service` |
| Service user / group | `deploy` / `www-data` (same as booking-demo) |
| Checkout on the VPS | `/home/deploy/rsvp-site` |
| nginx static root | `/home/deploy/rsvp-site/static` |
| gunicorn socket | `/run/come-see/gunicorn.sock` (systemd `RuntimeDirectory=come-see`) |
| SQLite file | `/var/lib/come-see/rsvps.db` (systemd `StateDirectory=come-see`) |
| Events file | `/home/deploy/rsvp-site/static/events.json` |

## Environment variables read by the app

| Variable | Default | Purpose |
| --- | --- | --- |
| `RSVP_DB_PATH` | `<instance dir>/rsvps.db` | SQLite file. Production sets `/var/lib/come-see/rsvps.db`. |
| `RSVP_EVENTS_PATH` | `<repo>/static/events.json` | Event list, used to validate `event_id`. |
| `GUNICORN_BIND` | `unix:/run/come-see/gunicorn.sock` | gunicorn bind address. |
| `GUNICORN_PROCESSES` / `GUNICORN_THREADS` / `GUNICORN_TIMEOUT` | `2` / `4` / `30` | gunicorn sizing. |

The app creates the `rsvps` table on startup if it does not exist. There is no
separate init step.

## events.json

Served as a static file by nginx. The frontend fetches it directly; the app
reads it only to validate event ids on write.

```json
{
  "title": "Ethan's week home",
  "intro": "One line shown under the title.",
  "events": [
    {
      "id": "fri-dinner",
      "title": "Dinner at Mom's",
      "start": "2026-10-09T19:00:00-04:00",
      "end": "2026-10-09T21:30:00-04:00",
      "location": "Mom's house",
      "address": "123 Main St, Hometown, FL 32000",
      "description": "Bring nothing. Seriously."
    }
  ]
}
```

Rules:

- `id`: lowercase letters, digits, hyphens; `^[a-z0-9-]{1,40}$`. Unique.
- `start`, `end`: full ISO 8601 with a UTC offset. `end` is optional; when
  absent the frontend assumes two hours.
- `location` is the short label shown on the card; `address` is what goes into
  the calendar entry. Both optional.
- The frontend sorts by `start`. The file order does not matter.

## SQLite schema

```sql
CREATE TABLE IF NOT EXISTS rsvps (
  id           INTEGER PRIMARY KEY,
  event_id     TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  created_at   TEXT    NOT NULL   -- ISO 8601 UTC, e.g. 2026-10-01T14:03:00Z
);
CREATE INDEX IF NOT EXISTS rsvps_event_id ON rsvps (event_id);
```

## HTTP API

All responses are JSON. Errors have the shape `{"error": "<code>", "message": "<human text>"}`.

### `GET /api/health`

`200 {"ok": true}`. Used by the runbook to prove nginx reaches the socket.

### `GET /api/events/<event_id>/rsvps`

- `200 {"event_id": "fri-dinner", "count": 2, "rsvps": [{"display_name": "Sam", "created_at": "2026-10-01T14:03:00Z"}, ...]}`
  ordered by `created_at` ascending.
- `404 {"error": "unknown_event", ...}` when the id is not in events.json.

### `POST /api/events/<event_id>/rsvps`

Request body, `Content-Type: application/json`:

```json
{"display_name": "Sam", "website": ""}
```

`website` is the honeypot. Browsers never fill it; the frontend renders it as a
visually hidden input. If it is present and non-empty the app returns the
success shape below **without storing anything**, so bots see nothing unusual.

Validation of `display_name`, applied in this order:

1. Must be a string. Otherwise `400 invalid_name`.
2. Normalise to Unicode NFC. Trim leading and trailing whitespace; collapse
   internal runs of whitespace to one space. "Whitespace" here is ASCII
   whitespace (space, tab, CR, LF, FF, VT) plus the Unicode separator
   categories `Zs`, `Zl`, `Zp`. It is deliberately not `\s`, which would also
   swallow the C0 controls 1C-1F and U+0085 and hide them from step 4.
3. Reject if empty or longer than 40 code points after step 2: `400 invalid_name`.
4. Reject if it contains any character in Unicode category `Cc` (control),
   `Cf` (format: zero-width space, BOM, bidi overrides...), `Cs`, `Co`, or
   `Cn`: `400 invalid_name`. The one exception is U+200D zero width joiner,
   so emoji sequences still work.
5. Reject if the same event already has this name, compared case-insensitively
   (`str.casefold`) after step 2: `409 duplicate`.
6. Reject if the event already has 500 RSVPs (`RSVP_MAX_PER_EVENT` in app
   config): `409 event_full`. This exists only so one bored visitor cannot make
   the page unbounded; nginx's rate limit makes it slow to reach.

Other responses:

- `201 {"event_id": "fri-dinner", "display_name": "Sam", "created_at": "..."}` on success.
- `404 unknown_event` when the id is not in events.json.
- `400 invalid_json` when the body is not a JSON object.
- `413` when the body exceeds 1 KiB (Flask `MAX_CONTENT_LENGTH = 1024`).
- `429` comes from nginx (`limit_req`), never from the app. The frontend must
  handle it with a "slow down" message.
- Any other path under `/api/` is a JSON `404 not_found` for GET and a JSON
  `405 method_not_allowed` for other methods.

### Not in the API

There is no `GET /api/events`; the frontend reads `static/events.json`. There
is no delete; moderation is `sqlite3 /var/lib/come-see/rsvps.db` on the box.

## nginx routing

- `/` and everything not under `/api/` → static files from the static root, `try_files $uri $uri/ =404`.
- `/api/` → `proxy_pass` to the gunicorn socket with the same headers as booking-demo.
- `POST` on `/api/` → `limit_req` zone keyed by `$binary_remote_addr`, 10 requests per minute, burst 5, `nodelay`.

## Frontend behaviours

- Fetch `events.json`, sort by `start`, render one card per event with the
  day, time range in the visitor's local timezone, location, description.
- Per card: fetch the RSVP list on load, show names and count, and a form with
  one text input (`maxlength="40"`) plus the hidden `website` honeypot.
- On submit: `POST` JSON, then re-fetch the list. Map `409 duplicate` to "that
  name is already on the list", `409 event_full` and `400` to the server's
  message, `429` to "slow down and try again in a minute".
- "Add to calendar" per card offers two things, both generated client-side:
  a downloaded `.ics` file (UTC `DTSTART`/`DTEND`, `UID` = `<id>@come-see.ethancloin.xyz`)
  and a Google Calendar template link
  (`https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=<start>/<end>&details=...&location=...`
  with `dates` in `YYYYMMDDTHHMMSSZ`).
- No build step, no framework, no external requests except the two above.
