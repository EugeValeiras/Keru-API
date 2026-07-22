import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { Alert, AlertSeverity } from './entities/alert.entity';
import { Notification } from './entities/notification.entity';

export interface CreateAlertInput {
  patientId: string;
  recordId: string;
  metricKey: string | null;
  value: string | null;
  unit: string | null;
  severity: AlertSeverity;
  rangeVersion: string;
  message: string;
}

export interface CreateNotificationInput {
  recipientAccountId: string;
  patientId: string;
  alertId: string | null;
  type: string;
  title: string;
  body: string;
}

/**
 * AlertAccess (constitution §3.1). Verbos atómicos sobre alertas y el centro de notificaciones
 * (campana). Las notificaciones SIEMPRE se persisten (I6); el push es adicional (NotificationAccess,
 * TODO). Estado leída/no leída por destinatario.
 */
@ResourceAccess()
@Injectable()
export class AlertAccess {
  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
  ) {}

  // operation-identity: exempt — corre dentro de la transacción del registro clínico
  // (outbox atómico): el at-most-once lo garantiza el operationId del verbo padre.
  createAlert(input: CreateAlertInput, manager: EntityManager): Promise<Alert> {
    const repo = manager.getRepository(Alert);
    return repo.save(repo.create(input));
  }

  // operation-identity: exempt — misma transacción que el registro/alerta; el retry
  // no-opea en el verbo padre (createdByOperationId), acá no se duplica nada.
  createNotification(input: CreateNotificationInput, manager: EntityManager): Promise<Notification> {
    const repo = manager.getRepository(Notification);
    return repo.save(repo.create({ ...input, read: false }));
  }

  listForAccount(accountId: string): Promise<Notification[]> {
    return this.notifications.find({
      where: { recipientAccountId: accountId },
      order: { createdAt: 'DESC' },
    });
  }

  unreadCount(accountId: string): Promise<number> {
    return this.notifications.count({ where: { recipientAccountId: accountId, read: false } });
  }

  async markRead(id: string, accountId: string): Promise<void> {
    await this.notifications.update({ id, recipientAccountId: accountId }, { read: true });
  }

  /**
   * UC-18 · Marca TODAS las no leídas del destinatario como leídas y devuelve la cantidad
   * afectada. Naturalmente idempotente (repetir devuelve 0): sin operationId (NFR-34, aclaración).
   */
  async markAllRead(recipientAccountId: string): Promise<number> {
    const result = await this.notifications.update(
      { recipientAccountId, read: false },
      { read: true },
    );
    return result.affected ?? 0;
  }
}
