import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard } from '@keru/core';
import { CareConsultManager } from './manager/care-consult.manager';

/** Camino de lectura clínica (UC-14/15). Acceso por vínculo o asignación (validado en el Manager). */
@ApiTags('Care consult')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients/:patientId')
export class CareConsultController {
  constructor(private readonly consult: CareConsultManager) {}

  @Get('state')
  @ApiOperation({ summary: 'UC-14 · Estado actual (último valor por métrica, con as-of)' })
  @ApiOkResponse({ description: 'Estado actual del paciente' })
  state(@Param('patientId') patientId: string, @CurrentAccount() account: AuthPrincipal) {
    return this.consult.getCurrentState(patientId, account);
  }

  @Get('history')
  @ApiOperation({ summary: 'UC-14 · Historial cronológico (vitales, medicación, novedades)' })
  @ApiOkResponse({ description: 'Historial por tiempo de medición' })
  async history(@Param('patientId') patientId: string, @CurrentAccount() account: AuthPrincipal) {
    const records = await this.consult.getHistory(patientId, account);
    return records.map((r) => ({
      id: r.id,
      type: r.type,
      measuredAt: r.measuredAt,
      authorRole: r.authorRole,
      data: r.data,
      // NFR-38: la traza de corrección es parte del historial legible.
      supersedesRecordId: r.supersedesRecordId,
      correctionReason: r.correctionReason,
      supersededAt: r.supersededAt,
      supersededByRecordId: r.supersededByRecordId,
    }));
  }

  @Get('metrics/:metricKey/series')
  @ApiOperation({ summary: 'UC-15 · Serie temporal de una métrica (para graficar)' })
  @ApiOkResponse({ description: 'Puntos {measuredAt, value} ordenados' })
  series(
    @Param('patientId') patientId: string,
    @Param('metricKey') metricKey: string,
    @CurrentAccount() account: AuthPrincipal,
  ) {
    return this.consult.getSeries(patientId, metricKey, account);
  }
}
