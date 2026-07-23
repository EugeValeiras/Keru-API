import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard } from '@keru/core';
import { CareRecordManager } from './manager/care-record.manager';
import { CorrectRecordDto, RecordMedicationDto, RecordNoteDto, RecordVitalsDto } from './manager/dto/record.dto';
import { RecordResponseDto } from './manager/dto/responses.dto';

/**
 * Registro clínico (UC-12/13/20). Cuidador con asignación vigente o familiar vinculado.
 * El permiso se evalúa en el Manager al momento de la medición (NFR-30) — sin @Roles fijo acá.
 * Una llegada tardía no autorizada responde 201 con status 'quarantined' (UC-12 A3): el intento
 * queda en cuarentena para que el círculo lo resuelva — nunca 403 seco ni descarte silencioso.
 */
@ApiTags('Care record')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients/:patientId')
export class CareRecordController {
  constructor(private readonly careRecord: CareRecordManager) {}

  @Post('vitals')
  @ApiOperation({ summary: 'UC-12 · Registrar signos vitales (alerta si fuera de rango)' })
  @ApiCreatedResponse({ type: RecordResponseDto })
  async vitals(
    @Param('patientId') patientId: string,
    @Body() dto: RecordVitalsDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RecordResponseDto> {
    return RecordResponseDto.from(await this.careRecord.recordVitals(patientId, dto, account));
  }

  @Post('medications')
  @ApiOperation({ summary: 'UC-13 · Registrar medicación administrada' })
  @ApiCreatedResponse({ type: RecordResponseDto })
  async medication(
    @Param('patientId') patientId: string,
    @Body() dto: RecordMedicationDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RecordResponseDto> {
    return RecordResponseDto.from(await this.careRecord.recordMedication(patientId, dto, account));
  }

  @Post('records/:recordId/corrections')
  @ApiOperation({
    summary:
      'UC-12 A5 · Corregir un registro (NFR-38): versión nueva con autor y razón; el original queda superseded y las alertas se re-evalúan',
  })
  @ApiCreatedResponse({ type: RecordResponseDto })
  async correct(
    @Param('patientId') patientId: string,
    @Param('recordId') recordId: string,
    @Body() dto: CorrectRecordDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RecordResponseDto> {
    return RecordResponseDto.from(await this.careRecord.correctRecord(patientId, recordId, dto, account));
  }

  @Post('notes')
  @ApiOperation({ summary: 'UC-20 · Registrar novedad / comentario' })
  @ApiCreatedResponse({ type: RecordResponseDto })
  async note(
    @Param('patientId') patientId: string,
    @Body() dto: RecordNoteDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RecordResponseDto> {
    return RecordResponseDto.from(await this.careRecord.recordNote(patientId, dto, account));
  }
}
