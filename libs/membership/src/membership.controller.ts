import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { RegisterPatientDto } from './manager/dto/register-patient.dto';
import { UpdatePatientDto } from './manager/dto/update-patient.dto';
import { PatientLinkDto, PatientRecordDto, PatientResponseDto } from './manager/dto/patient-response.dto';

/**
 * Puerta de entrada del dominio Membership (constitution §3.2: Client → Manager).
 * Protegido por JwtAuthGuard (UC-04): el actor sale del token, no de un header.
 */
@ApiTags('Membership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class MembershipController {
  constructor(private readonly membership: MembershipManager) {}

  /**
   * UC-01 · Registrar paciente. Requiere rol de cuenta `family` (KER-50): administrar perfiles
   * de paciente es capacidad de `family` (constitution §2.8); caregiver/admin → 403. Es uno de
   * los dos puntos donde una cuenta gana un vínculo con un paciente (el otro es aceptar una
   * invitación, UC-03) — gatearlos por rol mantiene el invariante "solo family tiene vínculo".
   * El chequeo de rol lo hace RolesGuard (patrón UC-19/KER-38), no el Manager inline (§3.7).
   */
  @Post('patients')
  @Roles('family')
  @ApiOperation({
    summary: 'UC-01 · Registrar paciente (solo rol family)',
    description:
      'Crea el perfil del paciente y vincula al creador como consent-holder. Idempotente por operationId (NFR-34). ' +
      'Requiere rol de cuenta `family` (KER-50): caregiver/admin → 403.',
  })
  @ApiCreatedResponse({ type: PatientResponseDto })
  async registerPatient(
    @Body() dto: RegisterPatientDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<PatientResponseDto> {
    const result = await this.membership.registerPatient(dto, account.accountId);
    return {
      id: result.patient.id,
      fullName: result.patient.fullName,
      age: result.age,
      duplicateCandidateId: result.duplicateCandidateId,
    };
  }

  /** UC-22 · Listar los perfiles de paciente de la cuenta. */
  @Get('patients')
  @ApiOperation({ summary: 'UC-22 · Listar perfiles de paciente de la cuenta' })
  @ApiOkResponse({ type: PatientResponseDto, isArray: true })
  async myPatients(@CurrentAccount() account: AuthPrincipal): Promise<PatientResponseDto[]> {
    const patients = await this.membership.listMyPatients(account.accountId);
    return patients.map((p) => ({ id: p.patient.id, fullName: p.patient.fullName, age: p.age }));
  }

  /** UC-22 · Ver la ficha del paciente (cualquier rol de vínculo). */
  @Get('patients/:id')
  @ApiOperation({
    summary: 'UC-22 · Ver la ficha del paciente',
    description:
      'Ficha completa. Requiere vínculo con el paciente (cualquier rol); linkRole indica el rol de quien consulta.',
  })
  @ApiOkResponse({ type: PatientRecordDto })
  async patientRecord(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<PatientRecordDto> {
    const record = await this.membership.getPatientRecord(id, account.accountId);
    return PatientRecordDto.from(record.patient, record.age, record.linkRole);
  }

  /** UC-22 · Círculo del paciente: cuentas vinculadas y su rol (visible para cualquier vinculado). */
  @Get('patients/:id/links')
  @ApiOperation({
    summary: 'UC-22 · Círculo del paciente',
    description:
      'Cuentas vinculadas al paciente (displayName/email) con el rol de su vínculo. ' +
      'Visible para cualquier vinculado; una cuenta sin vínculo recibe 403.',
  })
  @ApiOkResponse({ type: PatientLinkDto, isArray: true })
  async patientCircle(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<PatientLinkDto[]> {
    const members = await this.membership.getPatientCircle(id, account.accountId);
    return members.map((m) => ({ ...m, since: m.since.toISOString() }));
  }

  /** UC-22 · Editar la ficha del paciente (solo consent-holder o manager). */
  @Patch('patients/:id')
  @ApiOperation({
    summary: 'UC-22 · Editar la ficha del paciente',
    description:
      'Set parcial de la ficha (naturalmente idempotente, sin operationId). Solo vínculos consent-holder o manager; queda auditado (quién, cuándo, qué campos).',
  })
  @ApiOkResponse({ type: PatientRecordDto })
  async updatePatient(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<PatientRecordDto> {
    const record = await this.membership.updatePatient(id, dto, account.accountId);
    return PatientRecordDto.from(record.patient, record.age, record.linkRole);
  }
}
