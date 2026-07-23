import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard, STEP_UP_HEADER, StepUpGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { CaregiverResponseDto } from './manager/dto/caregiver-response.dto';
import { CaregiverDetailDto } from './manager/dto/caregiver-detail.dto';
import {
  DeactivateCaregiverDto,
  RejectCaregiverDto,
  SetBadgesDto,
} from './manager/dto/admin-caregiver.dto';
import { CaregiverStatus } from './resource-access/entities/caregiver.entity';

/** UC-19 · Back-office: aprobación y verificación de cuidadores. Requiere rol `admin`. */
@ApiTags('Back-office')
@SkipThrottle() // interno (KER-14): ya exige JWT + rol admin
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/caregivers')
export class AdminCaregiverController {
  constructor(private readonly membership: MembershipManager) {}

  @Get('pending')
  @ApiOperation({ summary: 'UC-19 · Cola de cuidadores pendientes de aprobación' })
  @ApiOkResponse({ type: CaregiverResponseDto, isArray: true })
  async pending(): Promise<CaregiverResponseDto[]> {
    const list = await this.membership.listPendingCaregivers();
    return list.map(CaregiverResponseDto.from);
  }

  @Get()
  @ApiOperation({ summary: 'Listar cuidadores con filtro por estado (paginado)' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected', 'deactivated'] })
  @ApiQuery({ name: 'q', required: false, description: 'Busca por nombre o zona' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async list(
    @Query('status') status?: CaregiverStatus,
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const result = await this.membership.listCaregivers(status, q, Number(page), Number(pageSize));
    return { ...result, items: result.items.map(CaregiverResponseDto.from) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'UC-19 · Detalle del cuidador (con documentación para verificar)' })
  @ApiOkResponse({ type: CaregiverDetailDto })
  async detail(@Param('id') id: string): Promise<CaregiverDetailDto> {
    return CaregiverDetailDto.from(await this.membership.getCaregiverById(id));
  }

  @Post(':id/approve')
  @UseGuards(StepUpGuard) // NFR-33 (KER-38): operación sensible — rol admin NO alcanza
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({ summary: 'UC-19 · Aprobar cuenta (la publica en el marketplace). Exige step-up (NFR-33)' })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async approve(
    @Param('id') id: string,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(await this.membership.approveCaregiver(id, admin.accountId));
  }

  @Post(':id/reject')
  @UseGuards(StepUpGuard) // NFR-33 (KER-38)
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({ summary: 'UC-19 · Rechazar cuenta (con motivo). Exige step-up (NFR-33)' })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectCaregiverDto,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(
      await this.membership.rejectCaregiver(id, admin.accountId, dto.reason),
    );
  }

  @Put(':id/badges')
  @ApiOperation({ summary: 'UC-19 · Actualizar insignias de verificación (niveles independientes)' })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async badges(
    @Param('id') id: string,
    @Body() dto: SetBadgesDto,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(
      await this.membership.setCaregiverBadges(id, admin.accountId, dto),
    );
  }

  @Post(':id/deactivate')
  @ApiOperation({
    summary: 'OQ-8/NFR-31 · Desactivar (ocultar) cuidador; dispara el ripple encolado a Hiring',
  })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async deactivate(
    @Param('id') id: string,
    @Body() dto: DeactivateCaregiverDto,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(
      await this.membership.deactivateCaregiver(id, admin.accountId, dto.reason),
    );
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'OQ-8 · Reactivar cuidador desactivado (vuelve a visible)' })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async reactivate(
    @Param('id') id: string,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(
      await this.membership.reactivateCaregiver(id, admin.accountId),
    );
  }
}
