import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { HiringManager } from './manager/hiring.manager';
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
    return (await this.hiring.listRequestsForCaregiverAccount(account.accountId)).map(
      RequestResponseDto.from,
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
    return RequestResponseDto.from(result.request);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'UC-10 · Rechazar solicitud' })
  @ApiOkResponse({ type: RequestResponseDto })
  async decline(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(await this.hiring.declineRequest(id, account.accountId));
  }
}
