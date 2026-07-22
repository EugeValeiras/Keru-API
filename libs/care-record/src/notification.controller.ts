import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard } from '@keru/core';
import { CareRecordManager } from './manager/care-record.manager';
import { MarkAllReadResponseDto, NotificationDto } from './manager/dto/responses.dto';

/** UC-18 · Centro de notificaciones (campana). La campana existe siempre; el push es adicional. */
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly careRecord: CareRecordManager) {}

  @Get()
  @ApiOperation({ summary: 'UC-18 · Mis notificaciones' })
  @ApiOkResponse({ type: NotificationDto, isArray: true })
  async list(@CurrentAccount() account: AuthPrincipal): Promise<NotificationDto[]> {
    return (await this.careRecord.listNotifications(account.accountId)).map(NotificationDto.from);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'UC-18 · Contador de no leídas (badge de la campana)' })
  async unread(@CurrentAccount() account: AuthPrincipal): Promise<{ unread: number }> {
    return { unread: await this.careRecord.unreadCount(account.accountId) };
  }

  @Post('read-all')
  @ApiOperation({
    summary: 'UC-18 · Marcar todas las notificaciones como leídas',
    description: 'Marca todas las no leídas del destinatario. Idempotente: repetir devuelve updated=0.',
  })
  @ApiCreatedResponse({ type: MarkAllReadResponseDto })
  async readAll(@CurrentAccount() account: AuthPrincipal): Promise<MarkAllReadResponseDto> {
    const updated = await this.careRecord.markAllNotificationsRead(account.accountId);
    return { ok: true, updated };
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'UC-18 · Marcar notificación como leída' })
  async markRead(
    @Param('id') id: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<{ ok: true }> {
    await this.careRecord.markNotificationRead(id, account.accountId);
    return { ok: true };
  }
}
