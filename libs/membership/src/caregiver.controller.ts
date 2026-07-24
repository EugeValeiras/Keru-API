import { Body, Controller, Get, NotFoundException, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { RegisterCaregiverDto } from './manager/dto/register-caregiver.dto';
import { UpdateCaregiverProfileDto } from './manager/dto/update-caregiver-profile.dto';
import { CaregiverResponseDto } from './manager/dto/caregiver-response.dto';
import { AddCertificationDto, CertificationCatalogItemDto } from './manager/dto/certification-io.dto';

/** UC-02 · Perfil profesional del cuidador. Requiere cuenta con rol `caregiver`. */
@ApiTags('Caregivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('caregiver')
@Controller('caregivers')
export class CaregiverController {
  constructor(private readonly membership: MembershipManager) {}

  @Post()
  @ApiOperation({
    summary: 'UC-02 · Registrar cuidador',
    description: 'Crea el perfil profesional en estado pending. No visible en el marketplace hasta UC-19.',
  })
  @ApiCreatedResponse({ type: CaregiverResponseDto })
  async register(
    @Body() dto: RegisterCaregiverDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    const caregiver = await this.membership.registerCaregiver(dto, account.accountId);
    return CaregiverResponseDto.from(caregiver);
  }

  @Put('me')
  @ApiOperation({
    summary: 'UC-02 A2 · Re-enviar postulación tras rechazo',
    description:
      'Corrige los datos y re-envía. Solo desde estado rejected: el perfil vuelve a pending, se limpia el motivo de rechazo y las certificaciones vuelven a "no verificada". Naturalmente idempotente.',
  })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async resubmit(
    @Body() dto: RegisterCaregiverDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(await this.membership.resubmitCaregiver(dto, account.accountId));
  }

  @Patch('me')
  @ApiOperation({
    summary: 'UC-02 A3 · Editar el perfil aprobado',
    description:
      'Set parcial de foto, disponibilidad, tarifas, zona y modalidades sin re-aprobación (el perfil sigue aprobado y visible). La tarifa es efectivo-fechada (NFR-03/23): cada cambio agrega una versión al historial y las solicitudes existentes conservan su tarifa pinneada. Credenciales (nombre/especialidades/certificaciones) no se editan por esta vía.',
  })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async updateApproved(
    @Body() dto: UpdateCaregiverProfileDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(await this.membership.updateApprovedCaregiver(dto, account.accountId));
  }

  @Get('me')
  @ApiOperation({ summary: 'UC-02 · Ver mi perfil y estado de aprobación' })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async myProfile(@CurrentAccount() account: AuthPrincipal): Promise<CaregiverResponseDto> {
    const caregiver = await this.membership.getMyCaregiverProfile(account.accountId);
    if (!caregiver) throw new NotFoundException('Todavía no creaste tu perfil de cuidador');
    return CaregiverResponseDto.from(caregiver);
  }

  @Get('certification-catalog')
  @ApiOperation({ summary: 'KER-52 · Catálogo finito de tipos de certificación (con su insignia)' })
  @ApiOkResponse({ type: CertificationCatalogItemDto, isArray: true })
  async certificationCatalog(): Promise<CertificationCatalogItemDto[]> {
    const items = await this.membership.listCertificationCatalog();
    return items.map((i) => ({ key: i.key, label: i.label, badgeIcon: i.badgeIcon }));
  }

  @Post('me/certifications')
  @ApiOperation({
    summary: 'KER-52 (UC-02 A4) · Agregar una certificación del catálogo (con su documento privado)',
    description:
      'Aditiva: la certificación nueva nace pendiente y oculta, y entra a la cola de revisión del admin (UC-19). No toca las credenciales aprobadas. Idempotente por operationId (NFR-34).',
  })
  @ApiCreatedResponse({ type: CaregiverResponseDto })
  async addCertification(
    @Body() dto: AddCertificationDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    return CaregiverResponseDto.from(await this.membership.addCertification(dto, account.accountId));
  }
}
