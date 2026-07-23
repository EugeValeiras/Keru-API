import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard, PubSubUtility, Roles, RolesGuard } from '@keru/core';

/**
 * Dead-letter del outbox para el back-office (KER-33, G6): los eventos que agotaron sus
 * reintentos quedan acá — inspeccionables y reencolables, jamás descartados en silencio.
 * Requiere rol admin.
 */
@ApiTags('Ops')
@SkipThrottle() // interno (KER-14): ya exige JWT + rol admin
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/ops/outbox')
export class OutboxOpsController {
  constructor(private readonly pubsub: PubSubUtility) {}

  @Get('dead-letter')
  @ApiOperation({
    summary: 'KER-33 · Listar la dead-letter del outbox (eventos que agotaron reintentos)',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Máximo de filas (default 50)' })
  @ApiOkResponse({ description: 'Eventos dead-lettered, más recientes primero (attempts + lastError incluidos)' })
  list(@Query('limit') limit?: string) {
    return this.pubsub.listDeadLettered(limit ? Number(limit) : undefined);
  }

  @Post('dead-letter/:id/retry')
  @ApiOperation({
    summary: 'KER-33 · Reencolar un evento dead-lettered con reintentos frescos',
    description:
      'Verbo naturalmente idempotente (NFR-34): el jobId dedupea en la cola y el worker no ' +
      'reprocesa eventos ya despachados (flag dispatched); reintentar dos veces no duplica efectos.',
  })
  @ApiParam({ name: 'id', description: 'id del evento en outbox_event' })
  @ApiOkResponse({ description: 'Evento reencolado' })
  @ApiNotFoundResponse({ description: 'No existe o no está dead-lettered' })
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    const event = await this.pubsub.requeueDeadLetter(id);
    if (!event) throw new NotFoundException(`No hay evento dead-lettered con id ${id}`);
    return { requeued: true, id: event.id, type: event.type };
  }
}
