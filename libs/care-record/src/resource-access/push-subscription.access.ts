import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { PushSubscription } from './entities/push-subscription.entity';

export interface UpsertPushSubscriptionInput {
  accountId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * PushSubscriptionAccess (constitution §3.1). Verbos atómicos sobre las suscripciones Web Push.
 * Persistidas por cuenta y revocables (UC-18). El envío vive en NotificationTransport; acá solo
 * el registro de a quién se le puede pushear.
 */
@ResourceAccess()
@Injectable()
export class PushSubscriptionAccess {
  constructor(
    @InjectRepository(PushSubscription) private readonly subscriptions: Repository<PushSubscription>,
  ) {}

  /**
   * Alta/renovación de la suscripción de un navegador. Naturalmente idempotente por la
   * restricción única de endpoint: repetir actualiza claves/dueño, nunca duplica (NFR-34).
   */
  async upsertSubscription(input: UpsertPushSubscriptionInput): Promise<PushSubscription> {
    const existing = await this.subscriptions.findOne({ where: { endpoint: input.endpoint } });
    if (existing) {
      existing.accountId = input.accountId;
      existing.p256dh = input.p256dh;
      existing.auth = input.auth;
      return this.subscriptions.save(existing);
    }
    return this.subscriptions.save(this.subscriptions.create(input));
  }

  listForAccount(accountId: string): Promise<PushSubscription[]> {
    return this.subscriptions.find({ where: { accountId }, order: { createdAt: 'ASC' } });
  }

  listForAccounts(accountIds: string[]): Promise<PushSubscription[]> {
    if (accountIds.length === 0) return Promise.resolve([]);
    return this.subscriptions.find({ where: { accountId: In(accountIds) } });
  }

  /** Revoca la suscripción de un endpoint de la cuenta. Idempotente: repetir afecta 0. */
  async removeByEndpoint(accountId: string, endpoint: string): Promise<number> {
    const result = await this.subscriptions.delete({ accountId, endpoint });
    return result.affected ?? 0;
  }

  /** KER-38 (NFR-41): logout sin device identificado revoca TODAS las de la cuenta. Idempotente. */
  async removeForAccount(accountId: string): Promise<number> {
    const result = await this.subscriptions.delete({ accountId });
    return result.affected ?? 0;
  }

  /** Depura endpoints muertos (404/410 del push service), sin importar el dueño. */
  async removeStaleEndpoints(endpoints: string[]): Promise<void> {
    if (endpoints.length === 0) return;
    await this.subscriptions.delete({ endpoint: In(endpoints) });
  }
}
