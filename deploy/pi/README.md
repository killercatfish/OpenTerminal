# OpenTerminal on a Pi (tradepi), without Docker

tradepi holds the live trading keys, so OpenTerminal runs there as two plain systemd services
under its own user, `oterm`, like Fantasy RedZone. It doesn't use Docker: the Docker daemon runs as
root, and its port rules bypass ufw (Josh chose this 2026-10-20).

- **openterminal-api** listens on `127.0.0.1:4000` only. It fetches market data from the internet,
  and the unit blocks it from the home LAN and Tailscale.
- **openterminal-web** listens on the Pi's LAN address `:3000` only. It talks to browsers on the
  LAN and to the API on localhost, and the unit blocks the internet.
- Both are capped at 384 MB and half a core, at a lower priority than the bots.
- The **BOT widget** shows one paper account (paper-research by default). On the first install,
  `install.sh` copies that bot's two key lines into `/etc/openterminal/alpaca.env` and refuses a
  live account. The widget only reads (the API has no order routes), and it refuses outright when
  `ALPACA_PAPER=false`.
- The **BOTS (ALL)** widget shows every bot, live money included, with no keys at all. The API
  reads the bots' own read-only pages on the Pi (the overview on `127.0.0.1:8049`, then each bot's
  dashboard on 8050-8059). Equity comes from Alpaca through the bots; position prices are the
  strategy's last bar close.
- There's no Anthropic key, so the AI panel stays off.

The Pi never builds anything. The Mac builds the release, and the Pi only runs
`npm install --omit=dev` for the API's native SQLite module.

## Install or update

On the Mac, in `~/dev/OpenTerminal` (commit first; the release is named after the commit):

```sh
bash deploy/pi/build-release.sh
scp dist/openterminal-*.tgz tradepi:
ssh tradepi 'tar -xzf openterminal-*.tgz ./install.sh'
```

On tradepi, in your own terminal (it needs your sudo password):

```sh
ssh -t tradepi 'sudo bash ~/install.sh ~/openterminal-*.tgz && rm ~/install.sh ~/openterminal-*.tgz'
```

Then check:

```sh
ssh tradepi 'systemctl status openterminal-api openterminal-web --no-pager | grep -E "●|Active"'
curl -s http://192.168.1.227:3000/api/status
```

Open http://192.168.1.227:3000 from any LAN machine and add the **BOT** widget from the sidebar.
It isn't reachable over Tailscale by design.

An update is the same steps. The settings in `/etc/openterminal/` are kept, and the previous copy
stays in `/opt/openterminal.old`.

## Files on the Pi

| Path | What |
|---|---|
| `/opt/openterminal` | the release, owned by root, read-only to the services |
| `/var/lib/openterminal` | the API's SQLite cache and data (owned by oterm) |
| `/etc/openterminal/openterminal.env` | `API_KEY` (generated), `LAN_BIND`, `WEB_ORIGIN` |
| `/etc/openterminal/alpaca.env` | the paper keys, copied once and never printed |

To show a different paper account: `sudo rm /etc/openterminal/alpaca.env`, then rerun install.sh with
`PAPER_ENV=/opt/trading/instances/<bot>/.env`.

## Roll back or remove

```sh
# back to the previous release
ssh -t tradepi 'sudo sh -c "rm -rf /opt/openterminal && mv /opt/openterminal.old /opt/openterminal && systemctl restart openterminal-api openterminal-web"'
# remove completely
ssh -t tradepi 'sudo sh -c "systemctl disable --now openterminal-api openterminal-web; rm /etc/systemd/system/openterminal-*.service; systemctl daemon-reload; rm -rf /opt/openterminal /opt/openterminal.old /etc/openterminal /var/lib/openterminal; userdel oterm; ufw delete allow from 192.168.1.0/24 to any port 3000 proto tcp"'
```
