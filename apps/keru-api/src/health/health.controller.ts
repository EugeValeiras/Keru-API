import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { HealthUtility } from '@keru/core';

/**
 * Probe de salud (KER-33): público y sin auth — lo consumen el healthcheck de docker compose
 * y cualquier orquestador. 200 = DB + Redis arriba y outbox sin lag; 503 = degradado (el
 * detalle de cada check viaja en el body igual, para diagnóstico).
 */
@ApiTags('Health')
@SkipThrottle() // el healthcheck del contenedor pega cada pocos segundos; no debe comer cuota
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthUtility) {}

  @Get()
  @ApiOperation({
    summary: 'KER-33 · Salud de la API: DB, Redis y lag del outbox (healthcheck del contenedor)',
  })
  @ApiOkResponse({ description: 'Todos los checks arriba' })
  @ApiServiceUnavailableResponse({ description: 'Algún check caído o outbox con lag (detalle en el body)' })
  async check(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.check();
    if (report.status !== 'ok') res.status(503);
    return report;
  }
}
