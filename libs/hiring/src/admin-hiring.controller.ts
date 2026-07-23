import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { HiringManager } from './manager/hiring.manager';
import { CancelActiveDto } from './manager/dto/cancel-active.dto';
import { RequestResponseDto } from './manager/dto/hiring-responses.dto';

/** UC-09 A3 · Back-office: cancelación de asignación activa por soporte (KER-32). Rol `admin`. */
@ApiTags('Admin hiring')
@ApiBearerAuth()
@SkipThrottle() // interno (KER-14): ya exige JWT + rol admin
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/hiring-requests')
export class AdminHiringController {
  constructor(private readonly hiring: HiringManager) {}

  @Post(':id/cancel-active')
  @ApiOperation({
    summary: 'UC-09 A3 · Cancelar la asignación activa (admin/soporte, KER-32)',
    description:
      'Cierra el servicio aceptado/en curso con razón terminal `cancelled-by-admin`, audita y notifica a ambas partes por la campana (UC-18). Verbo mutante con operationId (NFR-34).',
  })
  @ApiOkResponse({ type: RequestResponseDto })
  async cancelActive(
    @Param('id') id: string,
    @Body() dto: CancelActiveDto,
    @CurrentAccount() admin: AuthPrincipal,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(await this.hiring.cancelActiveByAdmin(id, admin.accountId, dto), {
      viewer: 'requester',
    });
  }
}
