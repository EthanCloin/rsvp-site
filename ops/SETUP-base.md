# come-see: one-time setup on base (Hostinger KVM)

Do this once, as a user with sudo, on base. After it, every merge to `main`
deploys through `.github/workflows/deploy.yml`. Paths match `CONTRACT.md` and
`ops/SETUP.md`; only the web front differs (Caddy instead of nginx), and the site is public.

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

## 4. Caddy: put the site on the open web

Caddy is the program that answers web visitors on ports 80 and 443. It gets
the HTTPS certificate by itself and passes every request to the app's socket.
Its whole config is one file, `/etc/caddy/Caddyfile` (a copy lives in this repo
at `ops/caddy/Caddyfile`).

One thing is special on base: Tailscale already uses port 443 on base's
tailnet addresses, to publish the Vault MCP through Funnel. So Caddy is told to
listen only on base's public IP (`default_bind`). Leave the Funnel alone.

### 4a. Install Caddy from its official package source

These lines add Caddy's own apt repository and install it. Installing also
starts Caddy with a placeholder page.

```sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
caddy version
```

### 4b. Let Caddy reach the app's socket

Caddy runs as its own `caddy` user. The app's socket belongs to group
`www-data`, so Caddy joins that group. A group change only applies after a
restart.

```sh
sudo usermod -aG www-data caddy
sudo systemctl restart caddy
```

### 4c. Write the Caddyfile with base's public IP

The first line finds the address base uses to reach the internet (its public
IP, not a tailnet one). Check that it prints the IP Hostinger shows for the VPS
before going on.

```sh
PUBLIC_IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
echo "$PUBLIC_IP"
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.orig
sed "s/BASE_PUBLIC_IP/$PUBLIC_IP/" /home/deploy/rsvp-site/ops/caddy/Caddyfile | sudo tee /etc/caddy/Caddyfile > /dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

If `ops/caddy/Caddyfile` isn't on base yet (this branch not merged), copy the
file's contents from GitHub into `/etc/caddy/Caddyfile` by hand and replace
`BASE_PUBLIC_IP`. `validate` must print `Valid configuration`; if not, restore
with `sudo cp /etc/caddy/Caddyfile.orig /etc/caddy/Caddyfile`.

### 4d. Checks before DNS

```sh
sudo ss -ltnp | grep -E ':(80|443) '            # caddy on the public IP, tailscaled on tailnet IPs only
tailscale funnel status                           # Vault MCP still on 443
sudo curl -sS --unix-socket /run/come-see/gunicorn.sock http://localhost/api/health; echo
sudo ufw status                                   # if active: sudo ufw allow 80,443/tcp
```

Also open the VPS firewall in Hostinger's panel (VPS, Security, Firewall). If
it has any rules, add inbound TCP 80 and 443. Port 80 is needed for the
certificate check and for redirecting to HTTPS.

Until DNS moves, Caddy logs failed certificate attempts. That's expected.

## 5. Move DNS (last, once the app answers locally)

1. If the droplet holds RSVPs worth keeping, copy its
   `/var/lib/come-see/rsvps.db` to the same path on base (owner
   `deploy:www-data`) and restart `come-see` first. Base starts with an empty
   database otherwise.
2. Where ethancloin.xyz's DNS is managed, change the A record for
   `come-see` from the DigitalOcean droplet's IP to base's public IP. Delete
   any AAAA record for `come-see` (Caddy here listens on IPv4 only).
3. Watch Caddy get the certificate, then test from anywhere:

```sh
sudo journalctl -u caddy -f                       # look for "certificate obtained successfully"
curl -sS https://come-see.ethancloin.xyz/api/health; echo
```

Expected: `{"ok": true}`. Once it holds for a day, the droplet can go.

Not carried over from nginx: the 10-writes-per-minute rate limit on POST and
DELETE. Caddy has no built-in rate limit; add a plugin or app-side limit later
if spam shows up.

## 6. First deploy

In GitHub, Actions, "Deploy to base", Run workflow. It should end with
`[deploy] deployed <commit>`. The health check runs on base against the local
socket, so it doesn't depend on Caddy or DNS.
