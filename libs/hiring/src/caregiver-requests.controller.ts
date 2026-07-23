import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { HiringManager } from './manager/hiring.manager';
import { CancelActiveDto } from './manager/dto/cancel-active.dto';
import { RequestResponseDto } from './manager/dto/hiring-responses.dto';

/** Solicitudes desde el lado del cuidador (UC-10). Requiere rol caregiver. */
@ApiTags('Caregiver requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('caregiver')
@Controller('caregiver/requests')
export class CaregiverRequestsController {
  constructor(private readonly hiring: HiringManager) {}

  @Get()
  @ApiOperation({ summary: 'UC-10 · Solicitudes recibidas' })
  @ApiOkResponse({ type: RequestResponseDto, isArray: true })
  async list(@CurrentAccount() account: AuthPrincipal): Promise<RequestResponseDto[]> {
    return (await this.hiring.listRequestsForCaregiverAccount(account.accountId)).map((i) =>
      RequestResponseDto.from(i.request, { viewer: 'caregiver', patientName: i.patientName }),
    );
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'UC-10 · Aceptar solicitud (crea la asignación, UC-05)' })
  @ApiOkResponse({ type: RequestResponseDto })
  async accept(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    const result = await this.hiring.acceptRequest(id, account.accountId);
    return RequestResponseDto.from(result.request, { viewer: 'caregiver' });
  }

  @Post(':id/cancel-active')
  @ApiOperation({
    summary: 'UC-09 A3 · Cancelar la asignación activa (cuidador, KER-32)',
    description:
      'Cierra el servicio aceptado/en curso con razón terminal `cancelled-by-caregiver`, audita y notifica al solicitante por la campana (UC-18). Verbo mutante con operationId (NFR-34).',
  })
  @ApiOkResponse({ type: RequestResponseDto })
  async cancelActive(
    @Param('id') id: string,
    @Body() dto: CancelActiveDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(
      await this.hiring.cancelActiveByCaregiver(id, account.accountId, dto),
      { viewer: 'caregiver' },
    );
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'UC-10 · Rechazar solicitud' })
  @ApiOkResponse({ type: RequestResponseDto })
  async decline(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(await this.hiring.declineRequest(id, account.accountId), {
      viewer: 'caregiver',
    });
  }
}
