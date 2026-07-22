import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import {
  CreateInvitationDto,
  InvitationConfirmedDto,
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

  /** Pantalla de confirmación (deep link). Público: no requiere sesión para previsualizar. */
  @Get('invitations/:token')
  @ApiOperation({ summary: 'UC-03 · Previsualizar invitación' })
  @ApiOkResponse({ description: 'Datos de la invitación para la pantalla de confirmación' })
  preview(@Param('token') token: string) {
    return this.membership.previewInvitation(token);
  }

  /** Confirmar la invitación. Requiere sesión del invitado (desafío de identidad, NFR-19). */
  @Post('invitations/:token/confirm')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'UC-03 · Confirmar invitación y crear el vínculo' })
  @ApiOkResponse({ type: InvitationConfirmedDto })
  async confirm(
    @Param('token') token: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<InvitationConfirmedDto> {
    return this.membership.confirmInvitation(token, account.accountId, account.email);
  }
}
