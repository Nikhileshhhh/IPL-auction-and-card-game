#!/usr/bin/env bash
# Throwaway local PostgreSQL 16 cluster for development and tests (ADR-016).
# Usage: scripts/db/local-pg.sh start|stop|status|url
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${STUMPS_PGDATA:-$ROOT/.local/pg/data}"
SOCK="${STUMPS_PGSOCK:-$ROOT/.local/pg/sock}"
PORT="${STUMPS_PGPORT:-54329}"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

as_pg() {
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

case "${1:-start}" in
  start)
    mkdir -p "$DATA" "$SOCK"
    if [ "$(id -u)" = "0" ]; then chown -R postgres:postgres "$ROOT/.local/pg"; fi
    if [ ! -f "$DATA/PG_VERSION" ]; then
      as_pg "$BIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
    fi
    if ! as_pg "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      as_pg "$BIN/pg_ctl" -D "$DATA" -l "$ROOT/.local/pg/server.log" -w \
        -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c max_connections=200" start >/dev/null
    fi
    echo "postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    as_pg "$BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null || true
    ;;
  status)
    as_pg "$BIN/pg_ctl" -D "$DATA" status
    ;;
  url)
    echo "postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  *)
    echo "usage: $0 start|stop|status|url" >&2
    exit 2
    ;;
esac
