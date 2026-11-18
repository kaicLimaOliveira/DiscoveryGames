#!/usr/bin/env bash
# Smoke test do compose de dev: sobe tudo, espera /api/health pelo Caddy e confere a idempotência
# do migrate. Limpa com `docker compose down -v` ao sair (exceto com KEEP=1).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || ENV_FILE=".env.example"
compose() { docker compose --env-file "$ENV_FILE" "$@"; }

cleanup() {
  status=$?
  if [ "${KEEP:-0}" = "1" ]; then
    echo "KEEP=1: ambiente mantido (docker compose down -v para limpar)."
  else
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

echo "==> subindo o compose"
compose up -d --build --wait --wait-timeout 300

echo "==> aguardando /api/health via Caddy (ate 60 s)"
ok=0
for _ in $(seq 1 60); do
  if body=$(curl -fsS -m 5 http://localhost/api/health 2>/dev/null) && echo "$body" | grep -q '"status":"ok"'; then
    echo "$body"
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "FALHA: /api/health nao retornou status ok em 60 s" >&2
  compose ps >&2 || true
  compose logs --tail=40 web worker >&2 || true
  exit 1
fi

echo "==> migrate idempotente"
compose run --rm migrate

echo "SMOKE OK"
