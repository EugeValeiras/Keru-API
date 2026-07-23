import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, STEP_UP_HEADER, StepUpGuard } from '@keru/core';
import { CareRecordManager } from './manager/care-record.manager';
import { QuarantinedRecordDto } from './manager/dto/responses.dto';

/**
 * Cuarentena de llegadas tardías no autorizadas (UC-12 A3, NFR-30). El círculo la ve
 * (cualquier vinculado); resuelven consent-holder o manager — con auditoría. Aprobar promueve el
 * registro al historial con su measuredAt original (NFR-36); descartar marca, nunca borra.
 */
@ApiTags('Care record')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients/:patientId/quarantine')
export class QuarantineController {
  constructor(private readonly careRecord: CareRecordManager) {}

  @Get()
  @ApiOperation({ summary: 'UC-12 A3 · Items en cuarentena del paciente (NFR-30, visibles al círculo)' })
  @ApiOkResponse({ type: QuarantinedRecordDto, isArray: true })
  async list(
    @Param('patientId') patientId: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<QuarantinedRecordDto[]> {
    return (await this.careRecord.listQuarantineForPatient(patientId, account)).map(QuarantinedRecordDto.from);
  }

  @Post(':id/approve')
  @HttpCode(200)
  // NFR-33 (KER-38): liberar cuarentena mete en el historial un dato que la autorización normal
  // rechazó — operación sensible, exige re-confirmación step-up además del vínculo.
  @UseGuards(StepUpGuard)
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({ summary: 'UC-12 A3 · Aprobar: entra al historial con su measuredAt original (NFR-36). Exige step-up (NFR-33)' })
  @ApiOkResponse({ type: QuarantinedRecordDto })
  async approve(
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<QuarantinedRecordDto> {
    return QuarantinedRecordDto.from(await this.careRecord.approveQuarantined(patientId, id, account));
  }

  @Post(':id/discard')
  @HttpCode(200)
  @ApiOperation({ summary: 'UC-12 A3 · Descartar: queda marcado con traza, nunca se borra' })
  @ApiOkResponse({ type: QuarantinedRecordDto })
  async discard(
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<QuarantinedRecordDto> {
    return QuarantinedRecordDto.from(await this.careRecord.discardQuarantined(patientId, id, account));
  }
}
