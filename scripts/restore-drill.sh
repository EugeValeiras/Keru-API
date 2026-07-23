#!/usr/bin/env bash
# KER-35 · Restore drill del store clínico (NFR-25, T14).
#
# Toma el último dump del volumen keru_backups (servicio "backup" del compose), lo restaura
# en una base NUEVA (keru_restore_drill) y bootea la API real (imagen del compose) contra
# ella hasta que GET /api/v1/health responda ok. Procedimiento, RPO/RTO y gap-disclosure:
# docs/ops/backups.md.
#
# Requiere el stack corriendo (docker compose up -d) y la imagen api buildeada
# (docker compose --profile app build api). No toca la base "keru" ni los contenedores
# del stack: todo pasa por contenedores efímeros y la base nueva del drill.
#
# Uso: scripts/restore-drill.sh [archivo.dump] [--keep]
#   archivo.dump  ruta dentro del volumen (p.ej. /backups/keru-20260723T101500Z.dump);
#                 default: el dump más nuevo.
#   --keep        no dropear keru_restore_drill al final (inspección post-drill).
set -euo pipefail

# Git Bash (Windows) reescribe argumentos tipo /backups/... a rutas C:/... antes de
# pasarlos a docker.exe: apagar la conversión (no pasamos rutas del host en ningún arg).
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

cd "$(dirname "$0")/.."

DRILL_DB=keru_restore_drill
DRILL_API=keru-restore-drill-api
KEEP_DB=false
DUMP=""
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP_DB=true ;;
    *) DUMP="$arg" ;;
  esac
done

compose() { docker compose --profile app "$@"; }
# Contenedor efímero con el volumen de backups, la red del stack y las PG* del servicio backup.
in_backup() { compose run --rm --no-deps -T --entrypoint "$1" backup "${@:2}"; }

cleanup() {
  docker rm -f "$DRILL_API" >/dev/null 2>&1 || true
  # La instancia efímera registró colas bajo el prefix "drill" en el Redis compartido: barrerlas.
  compose exec -T redis sh -c "redis-cli --scan --pattern 'drill:*' | xargs -r redis-cli del" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== [1/5] Backup a restaurar"
if [ -z "$DUMP" ]; then
  DUMP=$(in_backup sh -c 'ls -1t /backups/keru-*.dump 2>/dev/null | head -1' | tr -d '\r')
fi
if [ -z "$DUMP" ]; then
  echo "No hay dumps en el volumen keru_backups: levantá el servicio de backup" >&2
  echo "(docker compose --profile app up -d backup) y esperá el primer ciclo." >&2
  exit 1
fi
in_backup sh -c "ls -l $DUMP"

echo "== [2/5] Base nueva: $DRILL_DB"
compose exec -T postgres psql -U keru -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DRILL_DB;" -c "CREATE DATABASE $DRILL_DB;"

echo "== [3/5] pg_restore (una transacción, aborta al primer error)"
in_backup pg_restore -d "$DRILL_DB" --no-owner --single-transaction "$DUMP"
echo "restore OK"

echo "== [4/5] Boot de la API (imagen prod) contra $DRILL_DB"
# BULLMQ_PREFIX=drill aísla sus colas del stack real en el Redis compartido (core.module).
# DB_MIGRATIONS_RUN=false: el drill valida el restore del esquema tal cual vino en el dump
# (ver nota sobre bases nacidas por synchronize en docs/ops/backups.md).
docker rm -f "$DRILL_API" >/dev/null 2>&1 || true
compose run -d --rm --no-deps --name "$DRILL_API" \
  -e DB_NAME="$DRILL_DB" -e DB_MIGRATIONS_RUN=false -e BULLMQ_PREFIX=drill api >/dev/null
HEALTH=""
for _ in $(seq 1 60); do
  HEALTH=$(docker exec "$DRILL_API" wget -qO- http://localhost:3000/api/v1/health 2>/dev/null) && break
  HEALTH=""
  sleep 2
done
if [ -z "$HEALTH" ]; then
  echo "La API no respondió /health ok tras 120s; últimos logs:" >&2
  docker logs --tail 50 "$DRILL_API" >&2 || true
  exit 1
fi
echo "health: $HEALTH"

echo "== [5/5] Sanidad de datos restaurados ($DRILL_DB)"
compose exec -T postgres psql -U keru -d "$DRILL_DB" -v ON_ERROR_STOP=1 -c \
  "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tablas,
          (SELECT count(*) FROM account)          AS cuentas,
          (SELECT count(*) FROM patient)          AS pacientes,
          (SELECT count(*) FROM clinical_record)  AS registros_clinicos,
          (SELECT count(*) FROM alert)            AS alertas,
          (SELECT count(*) FROM outbox_event)     AS eventos_outbox;"

if [ "$KEEP_DB" = false ]; then
  # Bajar la API del drill ANTES del drop (sus conexiones abiertas bloquean el DROP).
  docker rm -f "$DRILL_API" >/dev/null 2>&1 || true
  compose exec -T postgres psql -U keru -d postgres \
    -c "DROP DATABASE IF EXISTS $DRILL_DB WITH (FORCE);" >/dev/null
  echo "Base $DRILL_DB dropeada (usá --keep para conservarla)."
else
  echo "Base $DRILL_DB conservada para inspección."
fi
echo "RESTORE DRILL OK — dump: $DUMP"
