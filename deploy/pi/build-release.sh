#!/usr/bin/env bash
# Build an OpenTerminal release on the Mac for a Pi (linux arm64), so the Pi never runs a Next.js
# build beside the trading bots. Output: dist/openterminal-<commit>.tgz. Install it with
# deploy/pi/install.sh on the Pi (steps in deploy/pi/README.md).
#
# The web side (Next.js standalone) is plain JavaScript and travels as built. The api side needs
# better-sqlite3, a native module, so only its compiled JS travels and install.sh runs
# `npm install --omit=dev` on the Pi to fetch the arm64 build.
set -euo pipefail
cd "$(dirname "$0")/../.."

[ -z "$(git status --porcelain -- server web package.json package-lock.json)" ] \
  || { echo "server/ or web/ has uncommitted changes; commit first so the release has a real commit id" >&2; exit 1; }
rev=$(git rev-parse --short HEAD)

npm run build

out=dist/release
rm -rf "$out" && mkdir -p "$out/server" "$out/web"
cp -R server/dist "$out/server/dist"
cp server/package.json "$out/server/"
cp -R web/.next/standalone/web/. "$out/web/"
cp -R web/.next/standalone/node_modules "$out/web/node_modules"
mkdir -p "$out/web/.next" && cp -R web/.next/static "$out/web/.next/static"
[ -d web/public ] && cp -R web/public "$out/web/public"
# sharp's Mac binaries are useless on the Pi; sharp falls back to its wasm build, and the
# terminal doesn't optimize images anyway.
rm -rf "$out"/web/node_modules/@img/sharp-darwin-* "$out"/web/node_modules/@img/sharp-libvips-darwin-*
cp deploy/pi/install.sh deploy/pi/openterminal-api.service deploy/pi/openterminal-web.service "$out/"
echo "$rev" > "$out/REVISION"

tar -czf "dist/openterminal-$rev.tgz" -C "$out" .
echo "dist/openterminal-$rev.tgz ($(du -h "dist/openterminal-$rev.tgz" | cut -f1))"
