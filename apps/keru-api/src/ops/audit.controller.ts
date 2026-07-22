import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditUtility, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';

/** Visor del audit log para el back-office (NFR-33). Requiere rol admin. */
@ApiTags('Ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditUtility) {}

  @Get()
  @ApiOperation({ summary: 'NFR-33 · Listar el audit log (paginado, filtros por actor/acción)' })
  @ApiQuery({ name: 'actor', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ description: 'Página de entradas de auditoría' })
  list(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.list({
      actor,
      action,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
