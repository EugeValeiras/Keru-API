import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { HiringManager } from './manager/hiring.manager';
import { SearchCaregiversDto } from './manager/dto/search-caregivers.dto';
import { CreateRequestDto } from './manager/dto/create-request.dto';
import {
  CaregiverCardDto,
  CaregiverHistoryItemDto,
  CaregiverProfileDto,
  RequestResponseDto,
} from './manager/dto/hiring-responses.dto';

/** Marketplace (lado demanda). UC-06/07/08/09/16. Requiere rol family o patient. */
@ApiTags('Marketplace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('family', 'patient')
@Controller()
export class MarketplaceController {
  constructor(private readonly hiring: HiringManager) {}

  @Get('marketplace/caregivers')
  @ApiOperation({ summary: 'UC-06 · Buscar cuidadores (solo aprobados, filtros combinables)' })
  @ApiOkResponse({ type: CaregiverCardDto, isArray: true })
  async search(
    @Query() filters: SearchCaregiversDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<CaregiverCardDto[]> {
    const results = await this.hiring.search(filters, account.accountId);
    return results.map((r) => CaregiverCardDto.from(r.caregiver, r.isFavorite, r.rating));
  }

  @Get('marketplace/caregivers/:id')
  @ApiOperation({ summary: 'UC-07 · Ver perfil de cuidador' })
  @ApiOkResponse({ type: CaregiverProfileDto })
  async profile(@Param('id') id: string): Promise<CaregiverProfileDto> {
    return CaregiverProfileDto.fromProfile(await this.hiring.getProfile(id));
  }

  @Get('favorites')
  @ApiOperation({ summary: 'UC-08 · Listar favoritos' })
  @ApiOkResponse({ type: CaregiverCardDto, isArray: true })
  async favorites(@CurrentAccount() account: AuthPrincipal): Promise<CaregiverCardDto[]> {
    const list = await this.hiring.listFavorites(account.accountId);
    return list.map((r) => CaregiverCardDto.from(r.caregiver, true, r.rating));
  }

  @Post('favorites/:caregiverId')
  @ApiOperation({ summary: 'UC-08 · Marcar favorito (idempotente)' })
  async addFavorite(
    @Param('caregiverId') caregiverId: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<{ ok: true }> {
    await this.hiring.addFavorite(account.accountId, caregiverId);
    return { ok: true };
  }

  @Delete('favorites/:caregiverId')
  @ApiOperation({ summary: 'UC-08 · Quitar favorito' })
  async removeFavorite(
    @Param('caregiverId') caregiverId: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<{ ok: true }> {
    await this.hiring.removeFavorite(account.accountId, caregiverId);
    return { ok: true };
  }

  @Post('hiring-requests')
  @ApiOperation({ summary: 'UC-09 · Crear solicitud de contratación (una por paciente)' })
  @ApiOkResponse({ type: RequestResponseDto })
  async createRequest(
    @Body() dto: CreateRequestDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(await this.hiring.createRequest(dto, account.accountId), {
      viewer: 'requester',
    });
  }

  @Get('hiring-requests')
  @ApiOperation({ summary: 'UC-09 · Mis solicitudes' })
  @ApiOkResponse({ type: RequestResponseDto, isArray: true })
  async myRequests(@CurrentAccount() account: AuthPrincipal): Promise<RequestResponseDto[]> {
    return (await this.hiring.listMyRequests(account.accountId)).map((i) =>
      RequestResponseDto.from(i.request, { viewer: 'requester', caregiverName: i.caregiverName }),
    );
  }

  @Post('hiring-requests/:id/cancel')
  @ApiOperation({
    summary: 'UC-09 A2 · Cancelar solicitud pendiente (solo el solicitante)',
    description:
      'Cancela una solicitud mientras está pendiente; queda en estado terminal `cancelled` y el cuidador deja de verla como pendiente.',
  })
  @ApiOkResponse({ type: RequestResponseDto })
  async cancel(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(await this.hiring.cancelRequest(id, account.accountId), {
      viewer: 'requester',
    });
  }

  @Post('hiring-requests/:id/complete')
  @ApiOperation({
    summary: 'UC-09 · Completar el servicio (cierre con razón terminal, independiente del pago)',
    description:
      'Cierra el servicio con razón terminal `completed` (Decouple row 49). El pago no participa: declararlo es un paso opcional posterior (`declare-paid`).',
  })
  @ApiOkResponse({ type: RequestResponseDto })
  async complete(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(await this.hiring.completeRequest(id, account.accountId), {
      viewer: 'requester',
    });
  }

  @Post('hiring-requests/:id/declare-paid')
  @ApiOperation({
    summary: 'UC-09 (OQ-1) · Declarar pagado (honor-mark opcional post-cierre)',
    description:
      'Marca de honor del solicitante sobre un servicio ya cerrado. Opcional: no condiciona el cierre ni la elegibilidad de reseña (NFR-10/20/58). Re-declarar es un no-op idempotente.',
  })
  @ApiOkResponse({ type: RequestResponseDto })
  async declarePaid(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(await this.hiring.declarePaid(id, account.accountId), {
      viewer: 'requester',
    });
  }

  @Get('patients/:patientId/caregivers')
  @ApiOperation({ summary: 'UC-16 · Cuidadores del paciente (vigentes e históricos)' })
  @ApiOkResponse({ type: CaregiverHistoryItemDto, isArray: true })
  async history(
    @Param('patientId') patientId: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<CaregiverHistoryItemDto[]> {
    const items = await this.hiring.caregiverHistory(patientId, account.accountId);
    return items.map((i) => CaregiverHistoryItemDto.from(i.assignment, i.caregiverName));
  }
}
