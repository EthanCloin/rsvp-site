# come-see: one-time setup on base (Hostinger KVM)

Do this once, as a user with sudo, on base. After it, every merge to `main`
deploys through `.github/workflows/deploy.yml`. Paths match `CONTRACT.md` and
`ops/SETUP.md`; only the web front differs (Caddy instead of nginx).

Assumes the `deploy` user exists and its key is in the repo's Actions secrets.

## 1. Packages

```sh
sudo apt update
sudo apt install -y git python3 python3-venv curl
```

## 2. Checkout and Python env, as deploy

```sh
sudo -iu deploy
git clone https://github.com/EthanCloin/rsvp-site.git /home/deploy/rsvp-site
cd /home/deploy/rsvp-site
python3 -m venv .venv
.venv/bin/pip install --quiet -r src/requirements.txt
chmod +x ops/deploy.sh ops/backup.sh
exit
```

Expected: `.venv/bin/gunicorn --version` prints a version.

## 3. Service and the narrow sudo rule

The service runs gunicorn as `deploy`. The sudo rule lets `deploy` restart
that one service without a password, which is all `ops/deploy.sh` needs.

```sh
cd /home/deploy/rsvp-site
sudo install -m 0644 -o root -g root ops/systemd/come-see.service /etc/systemd/system/come-see.service
sudo install -m 0440 -o root -g root ops/sudoers-come-see /etc/sudoers.d/come-see
sudo visudo -cf /etc/sudoers.d/come-see
```

`visudo` must print `parsed OK`. If not, run `sudo rm /etc/sudoers.d/come-see`
before anything else: a broken sudoers file can lock you out of sudo.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now come-see
sudo -iu deploy sudo -n systemctl restart come-see
sudo curl -sS --unix-socket /run/come-see/gunicorn.sock http://localhost/api/health; echo
```

Expected: no password prompt, then `{"ok": true}`.

## 4. Let Caddy reach the app

Caddy runs as its own `caddy` user. The app's socket belongs to group
`www-data`, and the static files live under `/home/deploy`.

```sh
sudo usermod -aG www-data caddy      # lets Caddy use the app's socket
sudo chmod o+x /home/deploy          # lets Caddy walk into /home/deploy to read static files
sudo systemctl restart caddy         # group changes only apply after a restart
```

## 5. Caddy site (tailnet only)

Add the site block. Caddy reads all its sites from one file,
`/etc/caddy/Caddyfile`; `validate` checks the whole file before you reload, so
a typo can't take down the Vault MCP's site.

```sh
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
cat /home/deploy/rsvp-site/ops/caddy/come-see.caddy | sudo tee -a /etc/caddy/Caddyfile > /dev/null
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -s http://127.0.0.1:8081/api/health; echo
```

Expected: `Valid configuration`, then `{"ok": true}`. If validate fails, restore
with `sudo cp /etc/caddy/Caddyfile.bak /etc/caddy/Caddyfile`.

## 6. Publish on the tailnet

```sh
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8081
tailscale serve status
```

Then open `https://<base's tailnet name>:8443` from a device on your tailnet.
Port 8443 keeps it apart from anything Funnel already publishes.

## 7. First deploy

In GitHub, Actions, "Deploy to base", Run workflow. It should end with
`[deploy] deployed <commit>`.
