# KER-35 · Restore drill del store clínico (NFR-25, T14) — equivalente Windows de
# restore-drill.sh (misma secuencia; ver ese script y docs/ops/backups.md para el detalle).
#
# Uso: .\scripts\restore-drill.ps1 [-Dump /backups/keru-....dump] [-Keep]
[CmdletBinding()]
param(
  [string]$Dump = '',
  [switch]$Keep
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$DrillDb = 'keru_restore_drill'
$DrillApi = 'keru-restore-drill-api'

function Invoke-InBackup {
  param([string]$Entrypoint, [string[]]$Cmd)
  & docker compose --profile app run --rm --no-deps -T --entrypoint $Entrypoint backup @Cmd
}

function Remove-DrillLeftovers {
  docker rm -f $DrillApi 2>$null | Out-Null
  # Barrer las colas del prefix "drill" que la instancia efímera dejó en el Redis compartido.
  docker compose --profile app exec -T redis sh -c "redis-cli --scan --pattern 'drill:*' | xargs -r redis-cli del" 2>$null | Out-Null
}

try {
  Write-Host '== [1/5] Backup a restaurar'
  if (-not $Dump) {
    $Dump = (Invoke-InBackup 'sh' @('-c', 'ls -1t /backups/keru-*.dump 2>/dev/null | head -1') | Select-Object -First 1)
    if ($Dump) { $Dump = $Dump.Trim() }
  }
  if (-not $Dump) {
    throw 'No hay dumps en el volumen keru_backups: levantá el servicio de backup (docker compose --profile app up -d backup) y esperá el primer ciclo.'
  }
  Invoke-InBackup 'sh' @('-c', "ls -l $Dump")

  Write-Host "== [2/5] Base nueva: $DrillDb"
  & docker compose --profile app exec -T postgres psql -U keru -d postgres -v ON_ERROR_STOP=1 `
      -c "DROP DATABASE IF EXISTS $DrillDb;" -c "CREATE DATABASE $DrillDb;"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base del drill.' }

  Write-Host '== [3/5] pg_restore (una transacción, aborta al primer error)'
  Invoke-InBackup 'pg_restore' @('-d', $DrillDb, '--no-owner', '--single-transaction', $Dump)
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore falló.' }
  Write-Host 'restore OK'

  Write-Host "== [4/5] Boot de la API (imagen prod) contra $DrillDb"
  # BULLMQ_PREFIX=drill aísla las colas del stack real; DB_MIGRATIONS_RUN=false valida el
  # esquema tal cual vino en el dump (nota synchronize en docs/ops/backups.md).
  docker rm -f $DrillApi 2>$null | Out-Null
  & docker compose --profile app run -d --rm --no-deps --name $DrillApi `
      -e DB_NAME=$DrillDb -e DB_MIGRATIONS_RUN=false -e BULLMQ_PREFIX=drill api | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo bootear la API del drill.' }
  $health = ''
  foreach ($i in 1..60) {
    $health = (docker exec $DrillApi wget -qO- http://localhost:3000/api/v1/health 2>$null)
    if ($LASTEXITCODE -eq 0 -and $health) { break }
    $health = ''
    Start-Sleep -Seconds 2
  }
  if (-not $health) {
    docker logs --tail 50 $DrillApi
    throw 'La API no respondió /health ok tras 120s.'
  }
  Write-Host "health: $health"

  Write-Host "== [5/5] Sanidad de datos restaurados ($DrillDb)"
  & docker compose --profile app exec -T postgres psql -U keru -d $DrillDb -v ON_ERROR_STOP=1 -c @"
SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tablas,
       (SELECT count(*) FROM account)          AS cuentas,
       (SELECT count(*) FROM patient)          AS pacientes,
       (SELECT count(*) FROM clinical_record)  AS registros_clinicos,
       (SELECT count(*) FROM alert)            AS alertas,
       (SELECT count(*) FROM outbox_event)     AS eventos_outbox;
"@
  if ($LASTEXITCODE -ne 0) { throw 'La query de sanidad falló.' }

  if (-not $Keep) {
    # Bajar la API del drill ANTES del drop (sus conexiones abiertas bloquean el DROP).
    docker rm -f $DrillApi 2>$null | Out-Null
    & docker compose --profile app exec -T postgres psql -U keru -d postgres `
        -c "DROP DATABASE IF EXISTS $DrillDb WITH (FORCE);" | Out-Null
    Write-Host "Base $DrillDb dropeada (usá -Keep para conservarla)."
  } else {
    Write-Host "Base $DrillDb conservada para inspección."
  }
  Write-Host "RESTORE DRILL OK — dump: $Dump"
}
finally {
  Remove-DrillLeftovers
}
