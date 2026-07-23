# Backups del store clínico y restore drill (KER-35 · NFR-25, T14)

> **Qué cubre.** Backup lógico automatizado de la base Postgres del stack prod-like
> (`docker compose`), retención configurable, y el procedimiento de restore verificado con
> un drill real (evidencia abajo). NFR-25 exige durabilidad clínica superior al store
> general; T14 (socio asegurador) exige una postura DR explícita — este documento es esa
> postura, **incluyendo lo que NO cubre** (gap-disclosure al final).

## 1. Cómo funciona el backup

Servicio `backup` en `docker-compose.yml` (profile `app`, igual que el resto del stack
prod-like): un contenedor `postgres:16-alpine` que cicla `pg_dump -Fc` contra la base
`keru` y poda por cantidad.

- **Formato:** `pg_dump -Fc` (custom, comprimido, restaurable con `pg_restore`). Dump
  lógico de la base completa `keru` — cubre las dos particiones lógicas (marketplace y
  clínica) que hoy conviven en la misma base.
- **Atomicidad:** el dump se escribe a `/backups/.<ts>.part` y se renombra a
  `keru-<ts>.dump` solo si `pg_dump` terminó bien: ni la poda ni un restore pueden ver un
  dump a medio escribir, y un dump fallido nunca pisa los previos.
- **Retención:** por cantidad, no por edad — se conservan los `BACKUP_KEEP` más nuevos.
- **Destino:** volumen Docker `keru_backups` (mismo host que la base — ver gap-disclosure).
- **Healthcheck:** el contenedor está sano si existe al menos un dump terminado.

Configuración (env del host, documentada en `.env.example`):

| Variable | Default | Significado |
|---|---|---|
| `BACKUP_INTERVAL_SECONDS` | `21600` (6 h) | Cada cuánto se corta un dump. **Es el RPO efectivo.** |
| `BACKUP_KEEP` | `28` | Dumps retenidos (28 × 6 h ≈ 7 días de historia). |

Operación cotidiana:

```bash
docker compose --profile app up -d backup        # levantar solo el servicio de backup
docker logs keru-backup                          # bitácora: "backup OK: keru-<ts>.dump (N bytes)"
# listar dumps del volumen
docker compose --profile app run --rm --no-deps -T --entrypoint sh backup -c 'ls -lt /backups'
# backup manual on-demand (misma nomenclatura que el ciclo)
docker exec keru-backup sh -c 'ts=$(date -u +%Y%m%dT%H%M%SZ); pg_dump -Fc -f "/backups/.$ts.part" && mv "/backups/.$ts.part" "/backups/keru-$ts.dump"'
# copiar un dump fuera del host (paso previo a un offsite manual)
docker cp keru-backup:/backups/keru-<ts>.dump ./
```

## 2. Restore drill

`scripts/restore-drill.sh` (bash / Git Bash) y `scripts/restore-drill.ps1` (PowerShell)
ejecutan el mismo drill de punta a punta **sin tocar la base real ni los contenedores del
stack**:

1. Elige el dump más nuevo del volumen (o el que se pase por argumento).
2. Crea una base **nueva** `keru_restore_drill` en el Postgres del stack.
3. `pg_restore --single-transaction` (aborta al primer error) desde un contenedor efímero.
4. Bootea la **imagen prod de la API** contra esa base (`DB_NAME=keru_restore_drill`,
   `BULLMQ_PREFIX=drill` para aislar sus colas del Redis compartido) y espera hasta que
   `GET /api/v1/health` responda `ok` (prueba DB + Redis + lag del outbox).
5. Query de sanidad (conteos de tablas y filas clave) y limpieza total: contenedor del
   drill, colas `drill:*` en Redis y la base del drill (salvo `--keep`/`-Keep`).

Requisitos: stack de infra arriba (`docker compose up -d`), imagen de la API buildeada
(`docker compose --profile app build api`) y al menos un dump en el volumen.

## 3. Evidencia del drill ejecutado

Ejecutado el **2026-07-23** en el stack prod-like local (`bash scripts/restore-drill.sh`,
exit 0, duración total ≈ 1 min con un dump de 320 KB):

```text
== [1/5] Backup a restaurar
-rw-r--r--    1 root     root        320075 Jul 23 10:20 /backups/keru-20260723T102025Z.dump
== [2/5] Base nueva: keru_restore_drill
DROP DATABASE
CREATE DATABASE
== [3/5] pg_restore (una transacción, aborta al primer error)
restore OK
== [4/5] Boot de la API (imagen prod) contra keru_restore_drill
health: {"status":"ok","checks":{"db":{"status":"up","latencyMs":2},"redis":{"status":"up","latencyMs":0},"outbox":{"status":"ok","lagThresholdMs":60000,"pending":0,"lagged":0,"deadLettered":0,"oldestPendingAgeMs":null}}}
== [5/5] Sanidad de datos restaurados (keru_restore_drill)
 tablas | cuentas | pacientes | registros_clinicos | alertas | eventos_outbox
--------+---------+-----------+--------------------+---------+----------------
     19 |     397 |       193 |                171 |     139 |              0
(1 row)

Base keru_restore_drill dropeada (usá --keep para conservarla).
RESTORE DRILL OK — dump: /backups/keru-20260723T102025Z.dump
```

La retención también se verificó en vivo: con 4 dumps en el volumen y `BACKUP_KEEP=3`, la
poda eliminó exactamente el más viejo (`removed '/backups/keru-20260723T101947Z.dump'`) y
conservó los 3 más nuevos.

## 4. Restore real (runbook, no drill)

Si hay que restaurar **la base real** tras una pérdida:

1. Bajar la API (`docker compose --profile app stop api webapp`) — nadie escribe durante
   el restore.
2. Preservar lo que quede: `ALTER DATABASE keru RENAME TO keru_corrupta_<fecha>;` y
   `CREATE DATABASE keru;` (desde `psql -U keru -d postgres` en `keru-postgres`).
3. Restaurar el último dump sano (mismo comando que el drill, apuntando a `keru`):
   `docker compose --profile app run --rm --no-deps -T --entrypoint pg_restore backup -d keru --no-owner --single-transaction /backups/keru-<ts>.dump`
4. Levantar la API y verificar `GET /api/v1/health` = `ok`.
5. Registrar el incidente: qué dump se usó, cuánto dato se perdió (ver RPO) y por qué.

## 5. RPO / RTO reales de este esquema

- **RPO = `BACKUP_INTERVAL_SECONDS` (default 6 h).** Todo lo escrito después del último
  dump se pierde en un restore. Para el store clínico esto es una pérdida potencial real
  de registros clínicos y alertas de hasta 6 horas.
- **RTO ≈ minutos a escala actual.** El drill completo (restore + boot + checks) corrió en
  ~1 minuto con un dump de 320 KB. Crece con el tamaño de la base; el dump lógico y el
  restore son O(datos), no O(constante) — re-medir el drill cuando la base crezca.

## 6. Gap-disclosure — qué NO cubre este esquema

Postura honesta para NFR-25/T14; nada de esto está mitigado hoy:

1. **Sin PITR (point-in-time recovery).** No se archivan WAL: solo se puede volver al
   instante de un dump, no a "justo antes del incidente". El RPO de horas es
   inaceptable para un SLA clínico serio — el paso siguiente natural es `wal-g`/`pgBackRest`
   con archivado continuo (RPO de segundos).
2. **Sin offsite.** Los dumps viven en un volumen Docker del MISMO host que la base: una
   falla de disco/host pierde la base **y** sus backups juntos. Mitigación manual interina:
   `docker cp` periódico a otra máquina; solución real: subir el dump a un object storage
   externo (respetando residencia in-country, NFR-45).
3. **Sin cifrado at-rest del dump.** El dump contiene datos clínicos en claro dentro del
   volumen. En prod real: cifrar el dump (edad/age, gpg) o el volumen, con claves fuera
   del host (NFR-45/48).
4. **Sin verificación automática del restore.** El drill es manual (este documento es la
   evidencia de UNA corrida). Un backup no probado no es un backup: falta agendar el drill
   (cron/CI) y alertar si falla.
5. **Monitoreo mínimo.** El healthcheck solo prueba "existe un dump"; no detecta frescura
   (un ciclo colgado con dumps viejos sigue "sano" hasta el restart del contenedor).
6. **Una sola base = una sola política.** NFR-25 pide durabilidad clínica SUPERIOR al
   store general, pero hoy ambas particiones comparten base y por lo tanto backup,
   retención y RPO. La separación física (y su política diferenciada) llega con el split
   de la unidad clínica (constitution §4).
7. **Nota del entorno dev:** la base `keru` local nació por `synchronize` y no tiene tabla
   `migrations`, por eso el drill bootea con `DB_MIGRATIONS_RUN=false` (valida el esquema
   tal cual vino en el dump). En una base nacida por migraciones (prod real), el boot del
   drill correría `migrationsRun` y debe reportar 0 pendientes.
