#!/usr/bin/env bash
# Install or update OpenTerminal on a Pi from a release built on the Mac (deploy/pi/build-release.sh).
# Run as root on the Pi:  sudo bash install.sh ~/openterminal-<commit>.tgz
#
#   LAN_BIND      the Pi's reserved LAN address; the web app listens there only (default 192.168.1.227, tradepi)
#   PAPER_ENV     a paper bot's .env to copy the Alpaca keys from on first install
#                 (default /opt/trading/instances/paper-research/.env)
#
# Keys and the API secret are copied or generated straight into files; nothing is printed.
set -euo pipefail
tgz=${1:?usage: sudo bash install.sh <openterminal-release.tgz>}
LAN_BIND=${LAN_BIND:-192.168.1.227}
PAPER_ENV=${PAPER_ENV:-/opt/trading/instances/paper-research/.env}
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
[ -f "$tgz" ] || { echo "no such file: $tgz" >&2; exit 1; }

# 1. Node from Ubuntu's own archive (no third-party apt repo on the bots' host).
command -v node >/dev/null && command -v npm >/dev/null || apt-get install -y nodejs npm
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' \
  || { echo "need Node 20 or newer, have $(node -v)" >&2; exit 1; }

# 2. Its own system user; it owns nothing but its state in /var/lib/openterminal.
id oterm >/dev/null 2>&1 || useradd --system --home-dir /var/lib/openterminal --shell /usr/sbin/nologin oterm

# 3. Unpack beside the live copy, fetch the api's runtime modules as oterm (not root), then swap.
new=/opt/openterminal.new
rm -rf "$new" && mkdir -p "$new" && tar -xzf "$tgz" -C "$new"
chown -R oterm:oterm "$new/server"
npmhome=$(mktemp -d) && chown oterm:oterm "$npmhome"
(cd "$new/server" && runuser -u oterm -- env HOME="$npmhome" npm install --omit=dev --no-audit --no-fund)
rm -rf "$npmhome"
runuser -u oterm -- sh -c "cd '$new/server' && node -e \"new (require('better-sqlite3'))(':memory:')\"" || {
  echo "better-sqlite3 has no prebuilt binary for this Node; run: sudo apt-get install -y build-essential python3, then rerun" >&2
  exit 1; }
chown -R root:root "$new" && chmod -R go-w "$new"
rm -rf /opt/openterminal.old
[ -d /opt/openterminal ] && mv /opt/openterminal /opt/openterminal.old
mv "$new" /opt/openterminal

# 4. Settings and secrets, created once and kept on updates. root-owned, readable by oterm only.
install -d -m 750 -o root -g oterm /etc/openterminal
conf=/etc/openterminal/openterminal.env
if [ ! -f "$conf" ]; then
  ( umask 027
    printf 'API_KEY=%s\nLAN_BIND=%s\nWEB_ORIGIN=http://%s:3000\n' "$(openssl rand -hex 32)" "$LAN_BIND" "$LAN_BIND" > "$conf" )
  chgrp oterm "$conf"
fi
keys=/etc/openterminal/alpaca.env
if [ ! -f "$keys" ]; then
  [ -f "$PAPER_ENV" ] || { echo "no $PAPER_ENV to copy paper keys from; set PAPER_ENV" >&2; exit 1; }
  if grep -qiE '^ALPACA_PAPER=false' "$PAPER_ENV"; then
    echo "$PAPER_ENV is a LIVE account; the BOT widget only takes paper keys" >&2; exit 1
  fi
  ( umask 027
    grep -E '^ALPACA_(KEY|SECRET)=' "$PAPER_ENV" > "$keys"
    echo 'ALPACA_PAPER=true' >> "$keys" )
  chgrp oterm "$keys"
  [ "$(grep -cE '^ALPACA_(KEY|SECRET)=.' "$keys")" = 2 ] || { echo "ALPACA_KEY/ALPACA_SECRET not both found in $PAPER_ENV" >&2; rm -f "$keys"; exit 1; }
fi

# 5. Units, then (re)start.
install -m 644 /opt/openterminal/openterminal-api.service /opt/openterminal/openterminal-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable openterminal-api openterminal-web
systemctl restart openterminal-api openterminal-web

# 6. ufw: LAN only on :3000. (The API on :4000 is localhost-only and needs no rule.)
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow from 192.168.1.0/24 to any port 3000 proto tcp comment 'openterminal (LAN)' >/dev/null
fi

echo "OpenTerminal $(cat /opt/openterminal/REVISION) installed. Check: systemctl status openterminal-api openterminal-web --no-pager"
echo "Then open http://$(sed -n 's/^LAN_BIND=//p' "$conf"):3000 from a LAN machine. Rollback: /opt/openterminal.old"
