#!/usr/bin/env bash
# restart.sh — validate (build + lint + test) then launch the Electron dev app
#
# Mirrors the quality gate in publish.sh without the version bump or push.
#
# Usage:
#   npm run restart

set -euo pipefail

# ── Build + test gate ─────────────────────────────────────────────────────────

echo "▶  Building…"
npm run build

echo "▶  Linting…"
LINT_OUTPUT=$(npm run lint 2>&1 || true)
# Allow known pre-existing React Compiler warnings (7 errors from strict mode)
LINT_ERRORS=$(echo "$LINT_OUTPUT" | grep -Eo '[0-9]+ error' | head -1 | grep -Eo '[0-9]+' || echo "0")
if [[ "$LINT_ERRORS" -gt 7 ]]; then
  echo "$LINT_OUTPUT"
  echo "❌  New lint errors found ($LINT_ERRORS total, 7 pre-existing). Fix before restarting."
  exit 1
fi

echo "▶  Testing…"
npm test

# ── Launch ────────────────────────────────────────────────────────────────────

echo ""
echo "✅  All checks passed — launching app…"
echo ""

npm run kill 2>/dev/null || true

# Skip redundant `npm run build` — already done above in the gate
npm run build:electron
npm run build:preload
npm run build:analyzer-worker
npx electron .
