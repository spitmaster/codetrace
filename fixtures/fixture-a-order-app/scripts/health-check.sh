#!/usr/bin/env bash
# health-check.sh — Fixture-A self-healthiness smoke test.
#
# What it does:
#   1. reseed the SQLite DB to a known state
#   2. spawn the backend on a private port
#   3. poll /health until ready (or fail after 30s)
#   4. exercise the 4 business endpoints with curl, asserting status codes
#      and the inventory invariant (stock-insufficient → 409)
#   5. always kill the backend on exit
#
# Exit codes:
#   0 — all assertions pass
#   1 — any assertion fails / backend never came up
#
# Run from repo root via `npm run fixture:health` or directly:
#   bash fixtures/fixture-a-order-app/scripts/health-check.sh
#
# Windows note: requires Git Bash (already required for `git` on PowerShell).

set -euo pipefail

# --- locate paths (script-relative, works from any cwd) ---------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/backend"

PORT="${FIXTURE_HEALTH_PORT:-4100}"   # avoid clashing with manual dev on :4000
BASE="http://localhost:${PORT}"
USER_ID="user_alice"
PRODUCT_BOOK="prod_book"
PRODUCT_KEYBOARD="prod_keyboard"

PASS=0
FAIL=0

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

# Cleanup runs on any exit path so we never orphan the backend process.
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    # Give it a moment to exit cleanly, then force.
    sleep 0.5
    kill -KILL "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# assert_status <label> <expected-status> <actual-status>
assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    green "  ✓ $label → $actual"
    PASS=$((PASS + 1))
  else
    red   "  ✗ $label → expected $expected got $actual"
    FAIL=$((FAIL + 1))
  fi
}

# http_status <method> <path> [-d body] [-H header] ...
# Prints just the HTTP status code (no body).
http_status() {
  local method="$1"; shift
  local path="$1"; shift
  curl -sS -o /dev/null -w "%{http_code}" -X "$method" \
    -H "Content-Type: application/json" \
    "$BASE$path" "$@" || echo "000"
}

# --- step 1: reseed --------------------------------------------------------
yellow "[1/4] Reseeding fixture DB..."
pushd "$BACKEND_DIR" > /dev/null
npm run seed --silent > /dev/null
popd > /dev/null

# --- step 2: spawn backend -------------------------------------------------
yellow "[2/4] Starting backend on port $PORT..."
pushd "$BACKEND_DIR" > /dev/null
PORT="$PORT" npx --yes tsx src/server.ts > "/tmp/fixture-a-health.log" 2>&1 &
SERVER_PID=$!
popd > /dev/null

# Poll /health up to 30s.
for i in $(seq 1 60); do
  code="$(http_status GET /health || echo 000)"
  if [[ "$code" == "200" ]]; then
    green "  backend up after ${i}x 500ms"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    red "  backend process died before becoming ready. Last log:"
    tail -20 /tmp/fixture-a-health.log >&2 || true
    exit 1
  fi
  sleep 0.5
done

if [[ "$code" != "200" ]]; then
  red "  backend never reported /health=200 within 30s"
  tail -20 /tmp/fixture-a-health.log >&2 || true
  exit 1
fi

# --- step 3: smoke the 4 endpoints + invariant check -----------------------
yellow "[3/4] Smoke-testing endpoints..."

# 3.1 health (already verified above, but assert again for the count).
assert_status "GET /health (no auth)"               200 "$(http_status GET /health)"

# 3.2 unauthorized — POST without x-user-id → 401
assert_status "POST /api/orders no auth"            401 "$(http_status POST /api/orders -d '{"items":[]}')"

# 3.3 happy path — create order (single call, body + status combined via -w)
CREATE_OUT=$(curl -sS -w $'\n%{http_code}' -X POST "$BASE/api/orders" \
  -H "Content-Type: application/json" \
  -H "x-user-id: $USER_ID" \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_BOOK\",\"quantity\":1}]}")
CREATE_STATUS=$(printf '%s' "$CREATE_OUT" | tail -n1)
CREATE_BODY=$(printf '%s' "$CREATE_OUT" | sed '$d')
assert_status "POST /api/orders happy"              201 "$CREATE_STATUS"

# Extract orderId from the create response body (jq-free, regex on the JSON).
NEW_ORDER_ID=$(printf '%s' "$CREATE_BODY" | sed -n 's/.*"orderId":"\([^"]*\)".*/\1/p')
if [[ -z "$NEW_ORDER_ID" ]]; then
  red "  ✗ could not parse orderId from create response: $CREATE_RESP"
  FAIL=$((FAIL + 1))
fi

# 3.4 list — should include the new order
assert_status "GET /api/orders (list)"              200 "$(http_status GET '/api/orders?page=1&pageSize=20' -H "x-user-id: $USER_ID")"

# 3.5 detail — own order
if [[ -n "$NEW_ORDER_ID" ]]; then
  assert_status "GET /api/orders/:id (own)"         200 "$(http_status GET "/api/orders/$NEW_ORDER_ID" -H "x-user-id: $USER_ID")"
  # cross-user → 404 (existence not leaked)
  assert_status "GET /api/orders/:id (cross-user)"  404 "$(http_status GET "/api/orders/$NEW_ORDER_ID" -H 'x-user-id: user_bob')"
fi

# 3.6 invariant — request more keyboards than stock (8) → 409 CONFLICT
assert_status "POST /api/orders stock-out"          409 "$(http_status POST /api/orders \
    -H "x-user-id: $USER_ID" \
    -d "{\"items\":[{\"productId\":\"$PRODUCT_KEYBOARD\",\"quantity\":99}]}")"

# 3.7 cancel — own pending order → 200
if [[ -n "$NEW_ORDER_ID" ]]; then
  assert_status "DELETE /api/orders/:id (cancel)"   200 "$(http_status DELETE "/api/orders/$NEW_ORDER_ID" -H "x-user-id: $USER_ID")"
  # re-cancel → 409 (state machine: already cancelled)
  assert_status "DELETE /api/orders/:id (re-cancel)" 409 "$(http_status DELETE "/api/orders/$NEW_ORDER_ID" -H "x-user-id: $USER_ID")"
fi

# --- step 4: report --------------------------------------------------------
yellow "[4/4] Result"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  red "FIXTURE HEALTH CHECK FAILED"
  echo ""
  echo "Backend log tail (/tmp/fixture-a-health.log):"
  tail -30 /tmp/fixture-a-health.log >&2 || true
  exit 1
fi
green "FIXTURE HEALTH CHECK PASSED"
