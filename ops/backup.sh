#!/usr/bin/env bash
# Nightly SQLite backup for come-see. Run as deploy (see ops/backup.cron).
#
#   /var/lib/come-see/rsvps.db  ->  /var/lib/come-see/backups/rsvps-YYYYmmdd-HHMM.db
#
# Uses sqlite3's .backup (online, consistent, safe while gunicorn is writing).
# Keeps 14 days. Exits non-zero if the backup file is missing or empty.
set -euo pipefail

DB=/var/lib/come-see/rsvps.db
BACKUP_DIR=/var/lib/come-see/backups
KEEP_DAYS=14

die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

command -v sqlite3 >/dev/null || die "sqlite3 not installed (apt install sqlite3)"
[ -r "$DB" ]          || die "database not readable at $DB"
[ -d "$BACKUP_DIR" ]  || die "backup dir missing: $BACKUP_DIR (see ops/SETUP.md)"
[ -w "$BACKUP_DIR" ]  || die "backup dir not writable by $(id -un): $BACKUP_DIR"

stamp=$(date +%Y%m%d-%H%M)
out="$BACKUP_DIR/rsvps-$stamp.db"

sqlite3 "$DB" ".backup '$out'"

[ -s "$out" ] || die "backup file missing or empty: $out"
sqlite3 "$out" 'PRAGMA integrity_check;' | grep -qx ok || die "integrity_check failed on $out"

# Prune old copies. Only touches files this script created.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'rsvps-*.db' -mtime +"$KEEP_DAYS" -delete

rows=$(sqlite3 "$out" 'SELECT count(*) FROM rsvps;' 2>/dev/null || echo '?')
printf '[backup] %s ok: %s (%s bytes, %s rsvps)\n' "$(date -Is)" "$out" "$(stat -c %s "$out")" "$rows"
