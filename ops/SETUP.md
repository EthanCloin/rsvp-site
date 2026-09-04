# come-see: first-time setup on the droplet

One pass, top to bottom, on the existing Ubuntu 24.04 droplet that already
runs booking-demo. Every path here comes from `CONTRACT.md`. Commands run as
`root` (or with `sudo`) unless the prompt says `deploy$`.

After this is done, every later deploy is one command: `ops/deploy.sh`.

| Thing | Value |
| --- | --- |
| Domain | `come-see.ethancloin.xyz` |
| Checkout | `/home/deploy/rsvp-site` |
| Static root | `/home/deploy/rsvp-site/static` |
| Unit | `come-see.service` (runs as `deploy:www-data`) |
| Socket | `/run/come-see/gunicorn.sock` |
| Database | `/var/lib/come-see/rsvps.db` |
| Backups | `/var/lib/come-see/backups/` |

## 0. Prerequisites

```sh
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip sqlite3 nginx certbot python3-certbot-nginx curl
```

Expected: everything but `sqlite3` (and maybe `python3-venv`) is already
installed from booking-demo; apt says so and moves on. `sqlite3 --version`
prints a version.

## 1. DNS

At Squarespace Domains, add a record:

| Host | Type | Data |
| --- | --- | --- |
| `come-see` | A | the droplet's public IP (same as booking-demo's) |

Verify from anywhere (can take a few minutes to propagate):

```sh
dig +short come-see.ethancloin.xyz
```

Expected: exactly the droplet IP. Do not run certbot (step 8) until this
resolves; the HTTP challenge will fail otherwise.

## 2. Clone as deploy

```sh
sudo -iu deploy
git clone git@github.com:EthanCloin/rsvp-site.git /home/deploy/rsvp-site   # or the https URL
cd /home/deploy/rsvp-site
git log --oneline -1
```

Expected: the clone lands at `/home/deploy/rsvp-site`, owned by deploy, and
`git log` shows the commit you mean to run. If the repo is private, set up the
same deploy key or token booking-demo uses.

## 3. venv + requirements

Still as deploy:

```sh
deploy$ cd /home/deploy/rsvp-site
deploy$ python3 -m venv .venv
deploy$ .venv/bin/pip install --quiet -r src/requirements.txt
deploy$ .venv/bin/gunicorn --version
deploy$ chmod +x ops/deploy.sh ops/backup.sh
deploy$ exit
```

Expected: `gunicorn (version 23.0.0)`. The venv lives at
`/home/deploy/rsvp-site/.venv`, which is what the unit's `ExecStart` points at.

## 4. Install the unit and the sudoers snippet

```sh
cd /home/deploy/rsvp-site
sudo install -m 0644 -o root -g root ops/systemd/come-see.service /etc/systemd/system/come-see.service
sudo install -m 0440 -o root -g root ops/sudoers-come-see /etc/sudoers.d/come-see
sudo visudo -cf /etc/sudoers.d/come-see
```

Expected from visudo: `/etc/sudoers.d/come-see: parsed OK`. If it says
anything else, delete the file before doing anything else (`sudo rm
/etc/sudoers.d/come-see`); a broken sudoers file is the one thing here that can
lock you out of sudo.

Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now come-see
sudo systemctl status come-see --no-pager
```

Expected: `Active: active (running)` and a line like `Listening at:
unix:/run/come-see/gunicorn.sock` from gunicorn. If it is `failed`, see
Troubleshooting; `journalctl -u come-see -n 50` has the Python traceback.

Check that deploy's passwordless sudo works (this is exactly what deploy.sh
runs; sudoers matches the arguments verbatim):

```sh
sudo -iu deploy sudo -n systemctl restart come-see
systemctl status come-see --no-pager
```

Expected: no password prompt, and status shows `active (running)` again with a
fresh start time.

## 5. Verify the socket and the app directly

```sh
ls -la /run/come-see/
ls -ld /var/lib/come-see /var/lib/come-see/rsvps.db
sudo curl -sS --unix-socket /run/come-see/gunicorn.sock http://localhost/api/health; echo
```

Expected:

```
drwxrwx---  2 deploy www-data   60 ... /run/come-see/
srwxrw----  1 deploy www-data    0 ... /run/come-see/gunicorn.sock
drwxr-x---  2 deploy www-data 4096 ... /var/lib/come-see
-rw-rw----  1 deploy www-data ...      /var/lib/come-see/rsvps.db
{"ok": true}
```

The directory is `0770` and the socket is `0660`, both group `www-data`, which
is how nginx gets in. `rsvps.db` exists because the app creates the table on
startup; there is no init step.

Also confirm nginx's user can read the static files. Ubuntu creates home
directories `0750`, and booking-demo already serves from `/home/deploy`, so this
should already pass:

```sh
sudo -u www-data cat /home/deploy/rsvp-site/static/events.json | head -3
```

Expected: the first lines of the JSON. If you get `Permission denied`, fix the
home directory traversal bit and check again:

```sh
sudo chmod o+x /home/deploy
```

## 6. nginx site (HTTP only for now)

```sh
sudo install -m 0644 -o root -g root ops/nginx/come-see.ethancloin.xyz /etc/nginx/sites-available/come-see.ethancloin.xyz
sudo ln -s /etc/nginx/sites-available/come-see.ethancloin.xyz /etc/nginx/sites-enabled/
sudo nginx -t
```

Expected:

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Only then:

```sh
sudo systemctl reload nginx
```

Never reload on a failed `nginx -t`; nginx keeps the old config running, but
a later restart would fail and take booking-demo down with it.

## 7. Check over plain HTTP

From your laptop:

```sh
curl -sI http://come-see.ethancloin.xyz/ | head -1
curl -sI http://come-see.ethancloin.xyz/events.json | grep -i cache-control
curl -s  http://come-see.ethancloin.xyz/api/health; echo
```

Expected: `HTTP/1.1 200 OK`, `Cache-Control: no-cache`, `{"ok": true}`. Open
http://come-see.ethancloin.xyz in a browser and you should see the event
cards. If you see the nginx default page or booking-demo instead, see
Troubleshooting (default site).

Optional: prove the rate limit is wired. 20 quick POSTs from one IP should
turn into 429s after the first 15:

```sh
for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{}' http://come-see.ethancloin.xyz/api/events/nope/rsvps; done; echo
```

Expected: a run of `404`s (unknown event, from the app) then `429`s (from
nginx).

## 8. TLS with certbot

```sh
sudo certbot --nginx -d come-see.ethancloin.xyz
```

Answer the prompts as you did for booking-demo (redirect: yes). Certbot edits
`/etc/nginx/sites-available/come-see.ethancloin.xyz` in place, adding the
`listen 443 ssl` block and the port-80 redirect, then reloads nginx itself.

```sh
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://come-see.ethancloin.xyz/ | head -1
curl -sI http://come-see.ethancloin.xyz/ | grep -i -e '^HTTP' -e location
curl -s https://come-see.ethancloin.xyz/api/health; echo
```

Expected: `HTTP/2 200` (or `HTTP/1.1 200 OK`), a `301` with
`Location: https://come-see.ethancloin.xyz/`, and `{"ok": true}`. Renewal is
automatic via the existing `certbot.timer`; `sudo certbot renew --dry-run`
proves it.

## 9. Backups

```sh
sudo install -d -m 0750 -o deploy -g www-data /var/lib/come-see/backups
sudo install -m 0644 -o root -g root ops/backup.cron /etc/cron.d/come-see-backup
sudo -iu deploy /home/deploy/rsvp-site/ops/backup.sh
ls -la /var/lib/come-see/backups/
```

Expected: `[backup] ... ok: /var/lib/come-see/backups/rsvps-YYYYmmdd-HHMM.db
(N bytes, 0 rsvps)` and one file in the listing. From now on cron runs it at
03:15 daily as deploy; the log is `/var/lib/come-see/backup.log`.

## 10. First real deploy

As deploy, the command you will use from now on:

```sh
sudo -iu deploy /home/deploy/rsvp-site/ops/deploy.sh
```

Expected: `[deploy] health: HTTP 200 {"ok": true}` then `[deploy] deployed
<sha> (<commit subject>)`. Done.

---

# Day 2

## Deploy

Push to the branch the box tracks, then:

```sh
ssh deploy@<droplet> /home/deploy/rsvp-site/ops/deploy.sh
```

That is the whole deploy: `git pull --ff-only`, `pip install`, restart, and a
health check through the socket. Non-zero exit and a status dump if the app
does not come back.

## Logs

```sh
journalctl -u come-see -f            # gunicorn + app (tracebacks land here)
journalctl -u come-see -n 100 --no-pager
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## Editing events

The event list is `static/events.json` in the checkout, served by nginx with
`Cache-Control: no-cache`. No restart needed; the next page load sees it. The
app re-reads it on each write to validate event ids.

Preferred: edit it in the repo, commit, push, `ops/deploy.sh`. Quick fix on
the box is fine too:

```sh
sudo -iu deploy
nano /home/deploy/rsvp-site/static/events.json
python3 -m json.tool /home/deploy/rsvp-site/static/events.json > /dev/null && echo valid
git -C /home/deploy/rsvp-site commit -am "events: ..."   # so the next pull does not choke
```

Ids must match `^[a-z0-9-]{1,40}$`; `start`/`end` need a UTC offset. Removing
an event does not remove its RSVP rows; they just stop being reachable.

## Moderation

Visitors can take their own name off a list from the browser they RSVP'd with:
the `POST` hands that browser a secret `token`, and a `DELETE` carrying it
removes that one row. Nobody can remove a name they did not write, and a visitor
who cleared their site data or switched devices has lost the token and will ask
you instead.

So removing someone else's name — or a name whose owner lost their token — is
still sqlite3 on the box:

```sh
sudo -iu deploy sqlite3 /var/lib/come-see/rsvps.db
```

```sql
.headers on
.mode column
SELECT id, event_id, display_name, created_at FROM rsvps ORDER BY event_id, created_at;
DELETE FROM rsvps WHERE id = 42;
-- or by name on one event:
DELETE FROM rsvps WHERE event_id = 'sun-dinner' AND display_name = 'Sam';
.quit
```

Deletes are live immediately; no restart. Run `ops/backup.sh` first if you are
about to delete a lot.

Rows written before the `token` column existed (anything from the first deploy)
have `token = NULL` and can only be removed here — the API refuses them with
`403 invalid_token`. The column is added by the app at startup; a deploy is all
it takes, and no row is rewritten.

## Restoring a backup

```sh
ls -la /var/lib/come-see/backups/
sudo systemctl stop come-see
sudo cp /var/lib/come-see/rsvps.db /var/lib/come-see/rsvps.db.pre-restore
sudo cp /var/lib/come-see/backups/rsvps-YYYYmmdd-HHMM.db /var/lib/come-see/rsvps.db
sudo rm -f /var/lib/come-see/rsvps.db-wal /var/lib/come-see/rsvps.db-shm /var/lib/come-see/rsvps.db-journal
sudo chown deploy:www-data /var/lib/come-see/rsvps.db
sudo chmod 0660 /var/lib/come-see/rsvps.db
sudo systemctl start come-see
sudo curl -sS --unix-socket /run/come-see/gunicorn.sock http://localhost/api/health; echo
```

Expected: `{"ok": true}` and the old names back on the page.

## Troubleshooting

- **`nginx -t` before any reload, every time.** A bad file does not break the
  running nginx, but the next restart (reboot, apt upgrade) fails and takes
  every site on the box down.
- **502 Bad Gateway** means nginx is fine and gunicorn is not up. `systemctl
  status come-see`, then `journalctl -u come-see -n 50`. Usual causes: a Python
  error at import (traceback in the journal), or the venv missing a package
  (`ops/deploy.sh` reinstalls it).
- **`connect() to unix:/run/come-see/gunicorn.sock failed (13: Permission
  denied)`** in `/var/log/nginx/error.log`: www-data cannot reach the socket.
  The unit's `Group=www-data` + `RuntimeDirectoryMode=0770` + `UMask=0007` are
  what make this work; check with `ls -la /run/come-see/` (expect
  `drwxrwx--- deploy www-data` and `srwxrw---- deploy www-data`). If the group
  is wrong, the unit file on disk is not the one in `ops/systemd/`; reinstall
  it and `daemon-reload` + `restart`.
- **`(2: No such file or directory)` for the socket**: gunicorn has not bound
  yet or is not running. Same as 502.
- **Wrong site answers** (nginx welcome page, or booking-demo, on
  come-see.ethancloin.xyz): another server block is catching the request.
  Check `ls -la /etc/nginx/sites-enabled/`; if `default` is there and you do
  not want it, `sudo rm /etc/nginx/sites-enabled/default`, `nginx -t`, reload.
  Also `dig +short come-see.ethancloin.xyz` to make sure DNS is really pointing
  here.
- **403 on `/`** or on `events.json`: www-data cannot read the static root.
  Step 5's `sudo -u www-data cat ...` test and `chmod o+x /home/deploy`.
- **404 on `/api/...` from nginx** (HTML error page, not JSON): the location
  block is missing or the site file did not get symlinked. JSON 404s with
  `"error": "unknown_event"` are from the app and mean the id is not in
  `events.json`.
- **429 while testing**: that is the rate limit doing its job (10 POSTs/min per
  IP, burst 5). Wait a minute.
- **`ops/deploy.sh` says "sudo: a password is required"**: the sudoers snippet
  is missing or misnamed. Redo step 4 and `visudo -cf`.
- **`git pull --ff-only` refuses**: uncommitted edits on the box (usually
  `events.json`). `git -C /home/deploy/rsvp-site status`, then commit or
  `git stash` them.
- **Backup cron did nothing**: `/etc/cron.d/come-see-backup` must be root-owned,
  `0644`, and the filename must not contain a dot. `grep CRON /var/log/syslog`
  (or `journalctl -u cron`) shows whether it fired;
  `/var/lib/come-see/backup.log` shows what it said.
