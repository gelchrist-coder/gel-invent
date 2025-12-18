#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env in $REPO_ROOT" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

export EMAIL_VERIFICATION_DEBUG=1

PY="$REPO_ROOT/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "Missing venv python at $PY" >&2
  exit 1
fi

"$PY" init_db.py >/dev/null

port="${1:-8010}"
log="/tmp/uvicorn_smoke_$port.log"

"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$port" >"$log" 2>&1 &
pid=$!
cleanup() {
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

base="http://127.0.0.1:$port"

for _ in $(seq 1 240); do
  if curl -s "$base/health" >/dev/null; then
    break
  fi
  sleep 0.25
done

if ! curl -s "$base/health" >/dev/null; then
  echo "Backend did not start on $base" >&2
  tail -n 120 "$log" >&2 || true
  exit 1
fi

email="test+$(date +%s)@example.com"
password='TestPassw0rd@1'

payload=$(printf '{"email":"%s","name":"%s","password":"%s","business_name":"%s","categories":["Groceries"]}' \
  "$email" "Test User" "$password" "Test Biz")

signup_resp=$(curl -s -X POST "$base/auth/signup" -H 'Content-Type: application/json' -d "$payload")
code=$(printf '%s' "$signup_resp" | "$PY" -c "import sys,json; d=json.load(sys.stdin); print(d.get('verification_code') or '')")

pre_body="$(mktemp)"
verify_body="$(mktemp)"
login_body="$(mktemp)"

pre_status=$(curl -s -o "$pre_body" -w '%{http_code}' -X POST "$base/auth/login" -F "username=$email" -F "password=$password")

verify_payload=$(printf '{"email":"%s","code":"%s"}' "$email" "$code")
verify_status=$(curl -s -o "$verify_body" -w '%{http_code}' -X POST "$base/auth/email/verify" -H 'Content-Type: application/json' -d "$verify_payload")

login_status=$(curl -s -o "$login_body" -w '%{http_code}' -X POST "$base/auth/login" -F "username=$email" -F "password=$password")

printf "signup=%s\n" "$signup_resp"
printf "code=%s\n" "$code"
printf "login_pre=%s %s\n" "$pre_status" "$(cat "$pre_body")"
printf "verify=%s %s\n" "$verify_status" "$(cat "$verify_body")"
printf "login_after=%s %s\n" "$login_status" "$(cat "$login_body")"

rm -f "$pre_body" "$verify_body" "$login_body"
