import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { Alert, AlertSeverity } from './entities/alert.entity';
import { Notification } from './entities/notification.entity';
import {
  DeliveryChannel,
  DeliveryStatus,
  NotificationDelivery,
} from './entities/notification-delivery.entity';

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

export interface RecordDeliveryOutcomeInput {
  notificationId: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  detail?: string | null;
}

/**
 * AlertAccess (constitution §3.1). Verbos atómicos sobre alertas, el centro de notificaciones
 * (campana) y el outcome de entrega por destinatario y canal (KER-34, NFR-11/26/27).
 * Las notificaciones SIEMPRE se persisten (I6); el push es adicional. Estado leída/no leída
 * por destinatario; leída = acuse (NFR-11, `readAt`).
 */
@ResourceAccess()
@Injectable()
export class AlertAccess {
  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationDelivery) private readonly deliveries: Repository<NotificationDelivery>,
  ) {}

  // operation-identity: exempt — corre dentro de la transacción del registro clínico
  // (outbox atómico): el at-most-once lo garantiza el operationId del verbo padre.
  createAlert(input: CreateAlertInput, manager: EntityManager): Promise<Alert> {
    const repo = manager.getRepository(Alert);
    return repo.save(repo.create(input));
  }

  /**
   * Supersede (KER-34, anti-T7): una alerta crítica nueva reemplaza a las anteriores NO acusadas
   * del mismo (paciente, métrica) — quedan trazadas (supersededAt/supersededByAlertId) y fuera
   * del circuito de escalación/reenvío. Corre en la MISMA transacción que la alerta nueva.
   * Devuelve cuántas reemplazó.
   */
  async supersedePriorUnacked(
    patientId: string,
    metricKey: string,
    newAlertId: string,
    manager: EntityManager,
  ): Promise<number> {
    const result = await manager
      .getRepository(Alert)
      .createQueryBuilder()
      .update(Alert)
      .set({ supersededAt: () => 'now()', supersededByAlertId: newAlertId })
      .where('"patientId" = :patientId', { patientId })
      .andWhere('"metricKey" = :metricKey', { metricKey })
      .andWhere('severity = :critical', { critical: 'critical' })
      .andWhere('"supersededAt" IS NULL')
      .andWhere('id != :newAlertId', { newAlertId })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM "notification" n WHERE n."alertId" = "alert"."id" AND n."read" = true)',
      )
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Barrido de escalación (KER-34, NFR-11) · claim pattern (UPDATE...RETURNING, multi-instancia-
   * safe): reclama las críticas más viejas que `cutoff` sin acuse de NADIE del círculo, no
   * superseded y no escaladas aún, marcándolas escaladas — cada alerta escala UNA sola vez.
   * El age-out es el propio claim: una superseded jamás se reclama (anti-T7).
   */
  async claimEscalatable(cutoff: Date): Promise<Alert[]> {
    const result = await this.alerts
      .createQueryBuilder()
      .update(Alert)
      .set({ escalatedAt: () => 'now()' })
      .where('severity = :critical', { critical: 'critical' })
      .andWhere('"escalatedAt" IS NULL')
      .andWhere('"supersededAt" IS NULL')
      .andWhere('"createdAt" < :cutoff', { cutoff })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM "notification" n WHERE n."alertId" = "alert"."id" AND n."read" = true)',
      )
      .returning('*')
      .execute();
    return result.raw as Alert[];
  }

  /** Las notificaciones (campana) de una alerta: los destinatarios del fan-out y sus ids. */
  listNotificationsForAlert(alertId: string): Promise<Notification[]> {
    return this.notifications.find({ where: { alertId } });
  }

  /**
   * operation-identity: exempt — misma transacción que el registro/alerta; además el fan-out de
   * alertas es at-most-once por restricción única (alertId, recipientAccountId): el INSERT hace
   * ON CONFLICT DO NOTHING y devuelve la fila ya existente (KER-34, NFR-27).
   * La campana queda `delivered` al persistir, en la MISMA transacción (NFR-26).
   */
  async createNotification(input: CreateNotificationInput, manager: EntityManager): Promise<Notification> {
    const repo = manager.getRepository(Notification);
    let notification: Notification;
    if (input.alertId) {
      const inserted = await repo
        .createQueryBuilder()
        .insert()
        .values({ ...input, read: false })
        .orIgnore()
        .returning('*')
        .execute();
      const row = (inserted.raw as Notification[])[0];
      notification = row
        ? repo.create(row)
        : await repo.findOneOrFail({
            where: { alertId: input.alertId, recipientAccountId: input.recipientAccountId },
          });
    } else {
      notification = await repo.save(repo.create({ ...input, read: false }));
    }
    await this.recordDeliveryOutcome(
      { notificationId: notification.id, channel: 'bell', status: 'delivered' },
      manager,
    );
    return notification;
  }

  /**
   * Outcome de entrega por (notificación, canal) — KER-34, NFR-26. Upsert: un reintento (p. ej.
   * la escalación re-pushea) refresca status/detail/recordedAt; el outcome es el del último intento.
   */
  // operation-identity: exempt — at-most-once por restricción única (notificationId, channel):
  // el INSERT hace ON CONFLICT DO UPDATE; repetirlo converge al mismo estado, nunca duplica.
  async recordDeliveryOutcome(input: RecordDeliveryOutcomeInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(NotificationDelivery) : this.deliveries;
    await repo
      .createQueryBuilder()
      .insert()
      .values({
        notificationId: input.notificationId,
        channel: input.channel,
        status: input.status,
        detail: input.detail ?? null,
        recordedAt: new Date(),
      })
      .orUpdate(['status', 'detail', 'recordedAt'], ['notificationId', 'channel'])
      .execute();
  }

  /** Outcomes de entrega de una notificación (por canal). */
  listDeliveryOutcomes(notificationId: string): Promise<NotificationDelivery[]> {
    return this.deliveries.find({ where: { notificationId } });
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

  /** Leída = acuse (NFR-11): `readAt` fija el PRIMER read; re-marcar no-opea (idempotente). */
  async markRead(id: string, accountId: string): Promise<void> {
    await this.notifications.update(
      { id, recipientAccountId: accountId, read: false },
      { read: true, readAt: new Date() },
    );
  }

  /**
   * UC-18 · Marca TODAS las no leídas del destinatario como leídas y devuelve la cantidad
   * afectada. Naturalmente idempotente (repetir devuelve 0): sin operationId (NFR-34, aclaración).
   */
  async markAllRead(recipientAccountId: string): Promise<number> {
    const result = await this.notifications.update(
      { recipientAccountId, read: false },
      { read: true, readAt: new Date() },
    );
    return result.affected ?? 0;
  }
}
