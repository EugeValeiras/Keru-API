import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard } from '@keru/core';
import { CareRecordManager } from './manager/care-record.manager';
import { MarkAllReadResponseDto, NotificationDto } from './manager/dto/responses.dto';
import { PushConfigDto, PushSubscriptionDto, SubscribePushDto, UnsubscribePushResponseDto } from './manager/dto/push.dto';

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

  // --- UC-18 · Web Push (adicional a la campana, constitution §2.7) ---

  @Get('push/config')
  @ApiOperation({
    summary: 'UC-18 · Config del canal push',
    description: 'Clave pública VAPID para suscribirse. enabled=false: el cliente no ofrece push, la campana sigue sola.',
  })
  @ApiOkResponse({ type: PushConfigDto })
  pushConfig(): PushConfigDto {
    return this.careRecord.getPushConfig();
  }

  @Get('push/subscriptions')
  @ApiOperation({ summary: 'UC-18 · Mis suscripciones push (por cuenta, revocables)' })
  @ApiOkResponse({ type: PushSubscriptionDto, isArray: true })
  async listPushSubscriptions(@CurrentAccount() account: AuthPrincipal): Promise<PushSubscriptionDto[]> {
    return (await this.careRecord.listPushSubscriptions(account.accountId)).map(PushSubscriptionDto.from);
  }

  @Post('push/subscriptions')
  @ApiOperation({
    summary: 'UC-18 flujo 1 · Suscribir este navegador al push',
    description: 'Idempotente por endpoint único: re-suscribir renueva claves/dueño, nunca duplica.',
  })
  @ApiCreatedResponse({ type: PushSubscriptionDto })
  async subscribePush(
    @Body() dto: SubscribePushDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<PushSubscriptionDto> {
    const sub = await this.careRecord.subscribePush(account.accountId, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
    });
    return PushSubscriptionDto.from(sub);
  }

  @Delete('push/subscriptions')
  @ApiOperation({
    summary: 'UC-18 · Revocar la suscripción push de un endpoint',
    description: 'A1: el usuario apaga el push; las alertas siguen en la campana. Idempotente: repetir devuelve removed=0.',
  })
  @ApiQuery({ name: 'endpoint', description: 'Endpoint (URL) de la suscripción a revocar.' })
  @ApiOkResponse({ type: UnsubscribePushResponseDto })
  async unsubscribePush(
    @Query('endpoint') endpoint: string,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<UnsubscribePushResponseDto> {
    const removed = await this.careRecord.unsubscribePush(account.accountId, endpoint ?? '');
    return { ok: true, removed };
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
