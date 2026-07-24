import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard, THROTTLE_LIMITS, THROTTLE_TTL_MS } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import {
  CreateInvitationDto,
  EmittedInvitationDto,
  InvitationConfirmedDto,
  InvitationPreviewDto,
  InvitationResponseDto,
} from './manager/dto/invitation.dto';

/** UC-03 · Invitación de vínculo familiar. */
@ApiTags('Invitations')
@Controller()
export class InvitationController {
  constructor(private readonly membership: MembershipManager) {}

  /** Emitir invitación desde la ficha del paciente (requiere estar vinculado). */
  @Post('patients/:patientId/invitations')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'UC-03 · Emitir invitación (30 min, un solo uso)' })
  @ApiCreatedResponse({ type: InvitationResponseDto })
  async issue(
    @Param('patientId') patientId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<InvitationResponseDto> {
    const inv = await this.membership.issueInvitation(
      patientId,
      account.accountId,
      dto.invitedEmail,
      dto.role ?? 'viewer',
    );
    return InvitationResponseDto.from(inv);
  }

  /** UC-03 A4 · Invitaciones emitidas del paciente (requiere estar vinculado). */
  @Get('patients/:patientId/invitations')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'UC-03 · Listar invitaciones emitidas (estado y vencimiento)' })
  @ApiOkResponse({ type: EmittedInvitationDto, isArray: true })
  async list(
    @Param('patientId') patientId: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<EmittedInvitationDto[]> {
    const invitations = await this.membership.listInvitations(patientId, account.accountId);
    return invitations.map(EmittedInvitationDto.from);
  }

  /** UC-03 A5 · Revocar una invitación pendiente (solo emisor o consent-holder). */
  @Post('invitations/:token/revoke')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'UC-03 · Revocar invitación (la deja inutilizable)' })
  @ApiOkResponse({ type: EmittedInvitationDto })
  async revoke(
    @Param('token') token: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<EmittedInvitationDto> {
    const revoked = await this.membership.revokeInvitation(token, account.accountId);
    return EmittedInvitationDto.from(revoked);
  }

  /** Pantalla de confirmación (deep link). Público: no requiere sesión para previsualizar.
   * Cuota reducida (KER-14): frena la adivinación de tokens por fuerza bruta. */
  @Get('invitations/:token')
  @Throttle({ default: { limit: THROTTLE_LIMITS.invitationPreview, ttl: THROTTLE_TTL_MS } })
  @ApiOperation({ summary: 'UC-03 · Previsualizar invitación' })
  @ApiOkResponse({ type: InvitationPreviewDto, description: 'Datos de la invitación para la pantalla de confirmación y el registro por invitación (KER-67)' })
  preview(@Param('token') token: string): Promise<InvitationPreviewDto> {
    return this.membership.previewInvitation(token);
  }

  /**
   * Confirmar la invitación. Requiere sesión del invitado (desafío de identidad, NFR-19) y rol
   * de cuenta `family` (KER-50): el círculo de un paciente se compone solo de cuentas family.
   * Es el segundo punto donde una cuenta gana un vínculo con un paciente (el otro es UC-01);
   * gatearlo por rol mantiene el invariante "solo family tiene vínculo". caregiver/admin → 403.
   */
  @Post('invitations/:token/confirm')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('family')
  @ApiOperation({ summary: 'UC-03 · Confirmar invitación y crear el vínculo (solo rol family)' })
  @ApiOkResponse({ type: InvitationConfirmedDto })
  async confirm(
    @Param('token') token: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<InvitationConfirmedDto> {
    return this.membership.confirmInvitation(token, account.accountId, account.email);
  }
}
