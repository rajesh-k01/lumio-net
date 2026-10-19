#!/usr/bin/env bash
# Publish Lumio to GitHub Pages.
#
#   ./dev/deploy.sh
#
# Copies site/ onto the gh-pages branch and pushes it. GitHub Pages then
# serves that branch at https://rajesh-k01.github.io/lumio-net/.
#
# One-time setup in GitHub (once, by a repo admin):
#   Settings -> Pages -> Build and deployment -> Source:
#   "Deploy from a branch" -> Branch: gh-pages -> Folder: / (root) -> Save
#
# Auth: uses the remote already configured in this repo. If the remote has no
# credentials, set one before running:
#   git remote set-url origin https://<user>:<token>@github.com/rajesh-k01/lumio-net.git
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${PAGES_BRANCH:-gh-pages}"
REMOTE="${PAGES_REMOTE:-origin}"
URL="${PAGES_URL:-https://rajesh-k01.github.io/lumio-net/}"

if [ ! -f "$ROOT/site/index.html" ]; then
  echo "error: $ROOT/site/index.html not found — run this from a clone of the repo." >&2
  exit 1
fi

REMOTE_URL="$(git -C "$ROOT" remote get-url "$REMOTE")"
if [ -z "$REMOTE_URL" ]; then
  echo "error: git remote '$REMOTE' not found in $ROOT" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Build: the site folder is the app. Nothing to compile.
cp -r "$ROOT/site/." "$TMP/"
# .nojekyll keeps GitHub from running the files through Jekyll.
touch "$TMP/.nojekyll"

cd "$TMP"
git init -q -b "$BRANCH"
git config user.name "${GIT_USER_NAME:-Lumio deploy}"
git config user.email "${GIT_USER_EMAIL:-deploy@lumio.local}"
git add -A
git commit -q -m "Deploy the site ($(date -u '+%Y-%m-%d %H:%M UTC'))"
git remote add origin "$REMOTE_URL"
git push -f "$REMOTE" "HEAD:refs/heads/$BRANCH"

echo
echo "Pushed $BRANCH to $(git -C "$ROOT" remote get-url "$REMOTE" | sed -E 's#https://[^@]*@#https://#')"
echo "GitHub Pages serves it at: $URL"
echo "First time only: Settings -> Pages -> Source: '$BRANCH' / (root) -> Save."
