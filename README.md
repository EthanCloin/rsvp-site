# come-see

A public RSVP page for a week of hometown events. Friends pick a display name,
see who else is coming, and add an event to their calendar. No accounts, no
event creation UI, no private data.

Live at <https://come-see.ethancloin.xyz> (once deployed).

## Layout

| Path | What it is |
| --- | --- |
| `static/` | The whole frontend. nginx serves this directory directly. `events.json` is the event list. |
| `src/app/` | Flask app: two JSON endpoints over one SQLite table. |
| `src/gunicorn_config.py` | Binds gunicorn to the Unix socket systemd creates. |
| `tests/` | pytest suite for the API. |
| `ops/` | nginx site file, systemd unit, deploy and backup scripts, and the VPS runbook. |
| `CONTRACT.md` | The API, data shapes, and server paths every part is built against. |
| `design/` | The visual design: `HANDOFF.md` is the implementation spec, the `.dc.html` files are the artboards behind it. |

## Run locally

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r src/requirements.txt -r src/requirements-dev.txt
cd src && flask --app app run --port 8000
```

The dev server serves `static/` at `/` and the API at `/api/`, so
<http://localhost:8000> is the full site. In production nginx serves `static/`
and only `/api/` reaches the app.

## Test

```sh
pytest
```

## Deploy

See `ops/SETUP.md` for first-time setup on the droplet and `ops/deploy.sh` for
every deploy after that.
