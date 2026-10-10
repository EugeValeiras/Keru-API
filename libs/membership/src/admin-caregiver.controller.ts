import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard, STEP_UP_HEADER, StepUpGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { CaregiverResponseDto } from './manager/dto/caregiver-response.dto';
import { CaregiverDetailDto } from './manager/dto/caregiver-detail.dto';
import {
  AdminUpdateCaregiverDto,
  AdminUpdateCertificationDto,
  DeactivateCaregiverDto,
  RejectCaregiverDto,
  SetBadgesDto,
} from './manager/dto/admin-caregiver.dto';
import { CertificationCatalogItemDto, RejectCertificationDto } from './manager/dto/certification-io.dto';
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

  @Get('certification-catalog')
  @ApiOperation({
    summary: '#49 (UC-19 A3) · Catálogo finito de tipos de certificación (para elegir el tipo al editar)',
    description: 'Mismo catálogo que GET /caregivers/certification-catalog (UC-02), expuesto al rol admin.',
  })
  @ApiOkResponse({ type: CertificationCatalogItemDto, isArray: true })
  async certificationCatalog(): Promise<CertificationCatalogItemDto[]> {
    const items = await this.membership.listCertificationCatalog();
    return items.map((i) => ({ key: i.key, label: i.label, iconKey: i.iconKey, badgeIcon: i.badgeIcon }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'UC-19 · Detalle del cuidador (con documentación para verificar)' })
  @ApiOkResponse({ type: CaregiverDetailDto })
  async detail(@Param('id') id: string): Promise<CaregiverDetailDto> {
    return CaregiverDetailDto.from(await this.membership.getCaregiverById(id));
  }

  @Patch(':id')
  @UseGuards(StepUpGuard) // NFR-33: mutación sobre datos de un tercero — rol admin NO alcanza
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({
    summary: '#49 (UC-19 A3) · Editar los datos del cuidador (identidad + perfil, set parcial). Exige step-up',
    description:
      'Corrige cualquier dato que el cuidador declaró: nombre/foto (viven en su cuenta, ADR-0003), especialidades, disponibilidad, tarifas, zona y modalidades. Funciona en cualquier estado y no toca status, insignias ni provenance. Solo las claves presentes se escriben; un body vacío no escribe ni audita. La tarifa es efectivo-fechada (NFR-03/23). Auditado.',
  })
  @ApiOkResponse({ type: CaregiverDetailDto })
  async update(
    @Param('id') id: string,
    @Body() dto: AdminUpdateCaregiverDto,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverDetailDto> {
    return CaregiverDetailDto.from(await this.membership.adminUpdateCaregiver(id, admin.accountId, dto));
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

  @Get(':id/certifications/:certId/document')
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({
    summary: 'KER-52 (UC-19) · Descargar el documento privado de una certificación (SOLO admin, auditado)',
    description: 'El binario del certificado escaneado. Solo rol admin (otros → 403); nunca hay URL pública; cada descarga se audita.',
  })
  async certificationDocument(
    @Param('id') id: string,
    @Param('certId') certId: string,
    @CurrentAccount() admin: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { body, contentType, filename } = await this.membership.getCertificationDocument(
      id,
      certId,
      admin.accountId,
    );
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(body);
  }

  @Post(':id/certifications/:certId/approve')
  @UseGuards(StepUpGuard) // NFR-33 (KER-38): decisión sensible
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({
    summary: 'KER-52 (UC-19) · Aprobar una certificación (se muestra con su insignia). Exige step-up',
  })
  @ApiOkResponse({ type: CaregiverDetailDto })
  async approveCertification(
    @Param('id') id: string,
    @Param('certId') certId: string,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverDetailDto> {
    return CaregiverDetailDto.from(
      await this.membership.approveCertification(id, certId, admin.accountId),
    );
  }

  @Post(':id/certifications/:certId/reject')
  @UseGuards(StepUpGuard) // NFR-33 (KER-38)
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({ summary: 'KER-52 (UC-19 A2) · Rechazar una certificación (con motivo). Exige step-up' })
  @ApiOkResponse({ type: CaregiverDetailDto })
  async rejectCertification(
    @Param('id') id: string,
    @Param('certId') certId: string,
    @Body() dto: RejectCertificationDto,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverDetailDto> {
    return CaregiverDetailDto.from(
      await this.membership.rejectCertification(id, certId, admin.accountId, dto.reason),
    );
  }

  @Patch(':id/certifications/:certId')
  @UseGuards(StepUpGuard) // NFR-33
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({
    summary: '#49 (UC-19 A3) · Corregir una certificación existente (tipo/institución/año). Exige step-up',
    description:
      'Set parcial. No cambia el estado de la certificación ni su documento privado (agregar una nueva o reemplazar el documento sigue siendo UC-02 A4, lo hace el cuidador). Auditado.',
  })
  @ApiOkResponse({ type: CaregiverDetailDto })
  async updateCertification(
    @Param('id') id: string,
    @Param('certId') certId: string,
    @Body() dto: AdminUpdateCertificationDto,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverDetailDto> {
    return CaregiverDetailDto.from(
      await this.membership.adminUpdateCertification(id, certId, admin.accountId, dto),
    );
  }

  @Delete(':id/certifications/:certId')
  @UseGuards(StepUpGuard) // NFR-33
  @ApiHeader({ name: STEP_UP_HEADER, required: true, description: 'Token corto de re-confirmación (POST /auth/step-up)' })
  @ApiOperation({
    summary: '#49 (UC-19 A3) · Dar de baja una certificación existente. Exige step-up',
    description:
      'Quita la certificación del perfil (cualquier estado) y recalcula la insignia derivada `certificaciones` (≥1 aprobada). Identidad/antecedentes no se tocan. Auditado.',
  })
  @ApiOkResponse({ type: CaregiverDetailDto })
  async removeCertification(
    @Param('id') id: string,
    @Param('certId') certId: string,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<CaregiverDetailDto> {
    return CaregiverDetailDto.from(
      await this.membership.adminRemoveCertification(id, certId, admin.accountId),
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
