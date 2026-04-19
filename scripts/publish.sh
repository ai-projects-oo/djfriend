#!/usr/bin/env bash
# publish.sh — bump version, tag, and push to trigger CI builds
#
# Usage:
#   ./scripts/publish.sh          # patch bump (1.0.25 → 1.0.26)
#   ./scripts/publish.sh minor    # minor bump (1.0.25 → 1.1.0)
#   ./scripts/publish.sh major    # major bump (1.0.25 → 2.0.0)
#   ./scripts/publish.sh 1.2.3    # explicit version

set -euo pipefail

BUMP=${1:-patch}

# ── Preflight ─────────────────────────────────────────────────────────────────

if [[ $(git rev-parse --abbrev-ref HEAD) != "main" ]]; then
  echo "❌  Not on main. Switch to main before publishing."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌  Uncommitted changes. Commit or stash first."
  exit 1
fi

git fetch origin --tags --quiet

if [[ $(git rev-parse HEAD) != $(git rev-parse origin/main) ]]; then
  echo "❌  Local main is not in sync with origin/main. Pull first."
  exit 1
fi

# ── Build + test gate ─────────────────────────────────────────────────────────

echo "▶  Building…"
npm run build

echo "▶  Linting…"
LINT_OUTPUT=$(npm run lint 2>&1 || true)
# Allow known pre-existing React Compiler warnings (7 errors from strict mode)
LINT_ERRORS=$(echo "$LINT_OUTPUT" | grep -Eo '[0-9]+ error' | head -1 | grep -Eo '[0-9]+' || echo "0")
if [[ "$LINT_ERRORS" -gt 7 ]]; then
  echo "$LINT_OUTPUT"
  echo "❌  New lint errors found ($LINT_ERRORS total, 7 pre-existing). Fix before publishing."
  exit 1
fi

echo "▶  Testing…"
npm test

# ── Version bump ──────────────────────────────────────────────────────────────

CURRENT=$(node -p "require('./package.json').version")

if [[ $BUMP =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW=$BUMP
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  case $BUMP in
    major) NEW="$((MAJOR + 1)).0.0" ;;
    minor) NEW="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    *)
      echo "❌  Unknown bump type: $BUMP. Use patch | minor | major | x.y.z"
      exit 1
      ;;
  esac
fi

echo ""
echo "  Current version : $CURRENT"
echo "  New version     : $NEW"
echo ""
read -rp "Publish v$NEW? [y/N] " CONFIRM
[[ $CONFIRM =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── Update package.json ───────────────────────────────────────────────────────

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$NEW';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# ── Commit + tag + push ───────────────────────────────────────────────────────

git add package.json
git commit -m "chore: bump version to $NEW"
git tag "v$NEW"
git push origin main
git push origin "v$NEW"

echo ""
echo "✅  Published v$NEW — CI builds triggered."
echo "    https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/\.git$//')/actions"
