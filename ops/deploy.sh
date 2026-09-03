#!/usr/bin/env bash
# Deploy come-see: pull, install deps, restart gunicorn, health-check.
#
# Run as deploy from anywhere:   /home/deploy/rsvp-site/ops/deploy.sh
# Needs /etc/sudoers.d/come-see installed (ops/sudoers-come-see) so the
# restart works without a password. Exits non-zero if anything fails,
# including the health check, so a broken deploy is loud.
set -euo pipefail

CHECKOUT=/home/deploy/rsvp-site
VENV="$CHECKOUT/.venv"
SOCK=/run/come-see/gunicorn.sock
UNIT=come-see
HEALTH_URL=http://localhost/api/health

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

# Running as root would leave root-owned files in .venv and the checkout,
# which then breaks the next deploy as deploy. Refuse early.
[ "$(id -un)" = deploy ] || die "run this as the deploy user, not $(id -un)"

cd "$CHECKOUT" || die "checkout not found at $CHECKOUT"

before=$(git rev-parse --short HEAD)

# Edits made on the box (usually static/events.json) that were never committed
# will block a pull if the same file changed upstream. Say so up front.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    log "WARNING: uncommitted changes in $CHECKOUT (git status). Pulling anyway;"
    log "         commit or stash them if the pull below refuses."
fi

log "pulling..."
git pull --ff-only
after=$(git rev-parse --short HEAD)

if [ ! -x "$VENV/bin/pip" ]; then
    log "creating venv at $VENV"
    python3 -m venv "$VENV"
fi

log "installing requirements..."
"$VENV/bin/pip" install --quiet --require-virtualenv -r src/requirements.txt

log "restarting $UNIT..."
sudo systemctl restart "$UNIT"

# systemd recreates /run/come-see on restart; give gunicorn a moment to bind.
for _ in $(seq 1 20); do
    [ -S "$SOCK" ] && break
    sleep 0.5
done
[ -S "$SOCK" ] || { systemctl status "$UNIT" --no-pager || true; die "socket never appeared at $SOCK"; }

# Health-check through the socket, the same way nginx reaches the app.
# Retry briefly: the socket can exist before the first worker is ready.
body=""; code="000"
for _ in $(seq 1 10); do
    body=$(curl -sS --max-time 5 --unix-socket "$SOCK" -o - -w '\n%{http_code}' "$HEALTH_URL" 2>/dev/null || true)
    code=${body##*$'\n'}
    body=${body%$'\n'*}
    [ "$code" = "200" ] && break
    sleep 0.5
done

log "health: HTTP $code $body"
if [ "$code" != "200" ] || ! printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
    systemctl status "$UNIT" --no-pager || true
    die "health check failed (see: journalctl -u $UNIT -n 50)"
fi

log "deployed $after ($(git log -1 --format='%s' HEAD))${before:+ [was $before]}"
