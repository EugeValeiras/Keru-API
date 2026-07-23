import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Manager, AuditUtility, AuthPrincipal, PermissionEngine, TransactionUtility } from '@keru/core';
import { AccountAccess } from '@keru/membership';
import { METRIC_DEFINITIONS } from '../metric-definitions';
import { CareRecordAccess } from '../resource-access/care-record.access';
import { ageInYearsAt, RangeAccess } from '../resource-access/range.access';
import { AlertAccess } from '../resource-access/alert.access';
import { QuarantineAccess } from '../resource-access/quarantine.access';
import { PushSubscriptionAccess } from '../resource-access/push-subscription.access';
import { NotificationTransport, PushPayload } from '../resource-access/notification-transport';
import { PushSubscription } from '../resource-access/entities/push-subscription.entity';
import { AlertEngine } from '../engine/alert.engine';
import { ClinicalRecord, ClinicalRecordType } from '../resource-access/entities/clinical-record.entity';
import { QuarantinedRecord } from '../resource-access/entities/quarantined-record.entity';
import { RecordMedicationDto, RecordNoteDto, RecordVitalsDto } from './dto/record.dto';

/** Resultado de un registro clínico: entró al historial o quedó en cuarentena (NFR-30). */
export type RecordOutcome =
  | { outcome: 'recorded'; record: ClinicalRecord }
  | { outcome: 'quarantined'; quarantined: QuarantinedRecord };

/** Push pendiente: se despacha DESPUÉS del commit — la campana es la garantía (§2.7). */
interface PendingPush {
  recipients: string[];
  payload: PushPayload;
}

/** Evento `hiring.assignment.closed` (KER-32): cierre de asignación activa (cancelación / no-show). */
export interface AssignmentClosedEvent {
  requestId: string;
  patientId: string;
  caregiverId: string;
  reason: string;
  note?: string | null;
  noShowReportedAt?: string | null;
  /** Cuentas a notificar por campana (la contraparte del actor que cerró). */
  recipientAccountIds: string[];
}

/**
 * CareRecordManager (constitution §3.1). Orquesta capturar → evaluar → persistir → notificar.
 * Permiso al momento de la medición (NFR-30); plausibilidad (A1); commit atómico registro +
 * obligación de alerta (Decouple row 35); notificación al círculo (campana, I6).
 * Llegada tardía no autorizada → cuarentena, nunca descarte silencioso (UC-12 A3, NFR-30).
 */
/** Vigencia del seed de defaults: epoch, para que cualquier measuredAt histórico resuelva versión. */
const SEED_EFFECTIVE_FROM = new Date('1970-01-01T00:00:00Z');

@Manager()
@Injectable()
export class CareRecordManager implements OnApplicationBootstrap {
  private readonly logger = new Logger(CareRecordManager.name);

  constructor(
    private readonly tx: TransactionUtility,
    private readonly careRecordAccess: CareRecordAccess,
    private readonly quarantineAccess: QuarantineAccess,
    private readonly rangeAccess: RangeAccess,
    private readonly alertAccess: AlertAccess,
    private readonly alertEngine: AlertEngine,
    private readonly accountAccess: AccountAccess,
    private readonly permission: PermissionEngine,
    private readonly audit: AuditUtility,
    private readonly pushSubscriptions: PushSubscriptionAccess,
    private readonly pushTransport: NotificationTransport,
  ) {}

  onApplicationBootstrap(): Promise<void> {
    return this.ensureSystemRangeDefaults();
  }

  /**
   * Seed de los defaults del sistema (NFR-17/28): garantiza que toda métrica del catálogo tenga
   * su versión de rango system-default en DB. Append-only e idempotente (at-most-once por
   * operationId): en una base migrada el seed ya existe por la migración y esto es un no-op;
   * en bases dev/e2e con `synchronize` es quien materializa los defaults. Audita solo los
   * inserts reales. Los VALORES nunca se editan acá: un cambio de rango es una versión nueva
   * (y su flujo de configuración queda diferido — NFR-29, UC-18/NFR-18).
   */
  async ensureSystemRangeDefaults(): Promise<void> {
    for (const def of Object.values(METRIC_DEFINITIONS)) {
      const { created, version } = await this.rangeAccess.appendVersion(
        {
          metricKey: def.key,
          scope: 'system-default',
          ageMinYears: null,
          ageMaxYears: null,
          min: def.defaultRange.min,
          max: def.defaultRange.max,
          unit: def.unit,
          effectiveFrom: SEED_EFFECTIVE_FROM,
          authorAccountId: null,
          authorRole: null,
        },
        `seed-system-default-${def.key}`,
      );
      if (created) {
        await this.audit.record({
          action: 'care-record.range-version.seeded',
          actor: 'system',
          target: { type: 'range_version', id: version.id },
          metadata: { metricKey: def.key, min: version.min, max: version.max, unit: version.unit },
        });
      }
    }
  }

  /**
   * KER-32 · Campana por cierre de asignación activa (UC-09 A3/A4). Lo invoca el worker del
   * outbox al despachar `hiring.assignment.closed` (Manager→Manager encolado, constitution §3.2).
   * CareRecord es el dueño de escritura de las notificaciones: la campana SIEMPRE se persiste
   * (§2.7); el push es adicional y best-effort. Idempotencia: el dispatch del outbox es
   * at-most-once por evento (markDispatched), acá no se re-chequea.
   */
  async handleAssignmentClosed(event: AssignmentClosedEvent): Promise<void> {
    const recipients = [...new Set(event.recipientAccountIds ?? [])].filter(Boolean);
    if (recipients.length === 0) return;

    const { title, body } = this.hiringClosureMessage(event);
    await this.tx.run(async (em) => {
      for (const recipientAccountId of recipients) {
        await this.alertAccess.createNotification(
          { recipientAccountId, patientId: event.patientId, alertId: null, type: 'hiring', title, body },
          em,
        );
      }
    });
    await this.dispatchPush([
      { recipients, payload: { type: 'hiring', patientId: event.patientId, title, body } },
    ]);
  }

  /** Texto de la campana según la razón terminal del cierre (UC-09 A3/A4). */
  private hiringClosureMessage(event: AssignmentClosedEvent): { title: string; body: string } {
    const byReason: Record<string, { title: string; body: string }> = {
      'cancelled-by-requester': {
        title: 'Asignación cancelada',
        body: 'El solicitante canceló la asignación activa.',
      },
      'cancelled-by-caregiver': {
        title: 'Asignación cancelada',
        body: 'El cuidador canceló la asignación activa.',
      },
      'cancelled-by-admin': {
        title: 'Asignación cancelada',
        body: 'Un administrador de la plataforma canceló la asignación activa.',
      },
      'no-show': {
        title: 'No-show registrado',
        body: 'El solicitante registró que el cuidador no se presentó al servicio.',
      },
    };
    const base = byReason[event.reason] ?? {
      title: 'Servicio cerrado',
      body: `El servicio cerró con razón ${event.reason}.`,
    };
    const body = event.note ? `${base.body} Motivo: ${event.note}` : base.body;
    return { title: base.title, body: body.slice(0, 500) };
  }

  // --- UC-12 · Registrar signos vitales ---
  async recordVitals(patientId: string, dto: RecordVitalsDto, principal: AuthPrincipal): Promise<RecordOutcome> {
    const measuredAt = this.resolveMeasuredAt(dto.measuredAt);
    const authority = await this.classifyWrite(patientId, principal, measuredAt);
    const authorRole = principal.role;

    const dup = await this.careRecordAccess.findByOperationId(dto.operationId);
    if (dup) return { outcome: 'recorded', record: dup }; // idempotente: no re-persiste ni re-alerta (NFR-34)

    // A1: rechazar valores implausibles (error de tipeo) antes de persistir — también en cuarentena.
    for (const v of dto.values) {
      const p = this.rangeAccess.getPlausible(v.metricKey);
      if (v.value < p.min || v.value > p.max) {
        throw new UnprocessableEntityException(
          `Valor implausible para ${v.metricKey}: ${v.value} ${p.unit}`,
        );
      }
    }

    if (authority === 'quarantine') {
      return this.quarantineAttempt(patientId, 'vitals', principal, measuredAt, { values: dto.values }, dto.operationId);
    }

    const pendingPush: PendingPush[] = [];
    const result = await this.tx.run(async (em) => {
      const record = await this.careRecordAccess.record(
        { patientId, type: 'vitals', authorAccountId: principal.accountId, authorRole, measuredAt, data: { values: dto.values } },
        dto.operationId,
        em,
      );

      await this.evaluateVitalsAndAlert(em, patientId, record, pendingPush);

      await this.audit.record({
        action: 'care-record.vitals.recorded',
        actor: principal.accountId,
        target: { type: 'clinical_record', id: record.id },
        metadata: { measuredAt },
        manager: em,
      });
      return { outcome: 'recorded', record } as const;
    });
    await this.dispatchPush(pendingPush);
    return result;
  }

  // --- UC-13 · Registrar medicación ---
  async recordMedication(patientId: string, dto: RecordMedicationDto, principal: AuthPrincipal): Promise<RecordOutcome> {
    const measuredAt = this.resolveMeasuredAt(dto.measuredAt);
    const authority = await this.classifyWrite(patientId, principal, measuredAt);
    const authorRole = principal.role;
    const data = { medication: dto.medication, dose: dto.dose, schedule: dto.schedule, observations: dto.observations };

    if (authority === 'quarantine') {
      return this.quarantineAttempt(patientId, 'medication', principal, measuredAt, data, dto.operationId);
    }

    const record = await this.careRecordAccess.record(
      { patientId, type: 'medication', authorAccountId: principal.accountId, authorRole, measuredAt, data },
      dto.operationId,
    );
    return { outcome: 'recorded', record };
  }

  // --- UC-20 · Registrar novedad ---
  async recordNote(patientId: string, dto: RecordNoteDto, principal: AuthPrincipal): Promise<RecordOutcome> {
    const measuredAt = this.resolveMeasuredAt(dto.measuredAt);
    const authority = await this.classifyWrite(patientId, principal, measuredAt);
    const authorRole = principal.role;

    const dup = await this.careRecordAccess.findByOperationId(dto.operationId);
    if (dup) return { outcome: 'recorded', record: dup };

    if (authority === 'quarantine') {
      return this.quarantineAttempt(patientId, 'note', principal, measuredAt, { text: dto.text }, dto.operationId);
    }

    const pendingPush: PendingPush[] = [];
    const result = await this.tx.run(async (em) => {
      const record = await this.careRecordAccess.record(
        { patientId, type: 'note', authorAccountId: principal.accountId, authorRole, measuredAt, data: { text: dto.text } },
        dto.operationId,
        em,
      );
      // Una novedad notifica al círculo (UC-20 -> UC-18), como informativa.
      pendingPush.push(
        await this.notifyCircle(em, patientId, principal.accountId, {
          alertId: null,
          type: 'note',
          title: 'Nueva novedad',
          body: dto.text.slice(0, 300),
        }),
      );
      return { outcome: 'recorded', record } as const;
    });
    await this.dispatchPush(pendingPush);
    return result;
  }

  // --- UC-12 A3 · Cuarentena (NFR-30): el círculo ve y resuelve ---

  /** El círculo ve los items en cuarentena (cualquier vinculado; incluye resueltos: traza). */
  async listQuarantineForPatient(patientId: string, principal: AuthPrincipal): Promise<QuarantinedRecord[]> {
    await this.permission.assertLinked({ accountId: principal.accountId, patientId });
    return this.quarantineAccess.listForPatient(patientId);
  }

  /**
   * Aprueba un item en cuarentena: entra al historial con su measuredAt y autor ORIGINALES
   * (NFR-36) y, si es vitals, se evalúan sus alertas como en cualquier ingreso (UC-12 A2).
   * Resuelven consent-holder o manager (UC-12 A3). Re-aprobar es no-op idempotente.
   */
  async approveQuarantined(patientId: string, id: string, principal: AuthPrincipal): Promise<QuarantinedRecord> {
    const item = await this.getResolvable(patientId, id, principal);
    if (item.status === 'approved') return item; // idempotente: re-aplicar no duplica
    if (item.status === 'discarded') throw new BadRequestException('El item ya fue descartado');

    const pendingPush: PendingPush[] = [];
    const approved = await this.tx.run(async (em) => {
      const record = await this.careRecordAccess.record(
        {
          patientId,
          type: item.type,
          authorAccountId: item.authorAccountId,
          authorRole: item.authorRole,
          measuredAt: item.measuredAt,
          data: item.data,
        },
        item.createdByOperationId ?? `quarantine-approve-${item.id}`,
        em,
      );
      if (item.type === 'vitals') await this.evaluateVitalsAndAlert(em, patientId, record, pendingPush);

      const resolvedAt = new Date();
      await this.quarantineAccess.resolve(
        id,
        { status: 'approved', resolvedByAccountId: principal.accountId, resolvedAt, approvedRecordId: record.id },
        em,
      );
      await this.audit.record({
        action: 'care-record.quarantine.approved',
        actor: principal.accountId,
        target: { type: 'quarantined_record', id },
        metadata: { recordId: record.id, recordType: item.type, measuredAt: item.measuredAt, authorAccountId: item.authorAccountId },
        manager: em,
      });
      return { ...item, status: 'approved', resolvedByAccountId: principal.accountId, resolvedAt, approvedRecordId: record.id } as QuarantinedRecord;
    });
    await this.dispatchPush(pendingPush);
    return approved;
  }

  /** Descarta un item en cuarentena: queda marcado, nunca se borra (trazabilidad). */
  async discardQuarantined(patientId: string, id: string, principal: AuthPrincipal): Promise<QuarantinedRecord> {
    const item = await this.getResolvable(patientId, id, principal);
    if (item.status === 'discarded') return item; // idempotente
    if (item.status === 'approved') throw new BadRequestException('El item ya fue aprobado');

    return this.tx.run(async (em) => {
      const resolvedAt = new Date();
      await this.quarantineAccess.resolve(
        id,
        { status: 'discarded', resolvedByAccountId: principal.accountId, resolvedAt },
        em,
      );
      await this.audit.record({
        action: 'care-record.quarantine.discarded',
        actor: principal.accountId,
        target: { type: 'quarantined_record', id },
        metadata: { recordType: item.type, measuredAt: item.measuredAt, authorAccountId: item.authorAccountId },
        manager: em,
      });
      return { ...item, status: 'discarded', resolvedByAccountId: principal.accountId, resolvedAt } as QuarantinedRecord;
    });
  }

  // --- UC-18 · Centro de notificaciones (campana) ---
  listNotifications(accountId: string) {
    return this.alertAccess.listForAccount(accountId);
  }
  unreadCount(accountId: string) {
    return this.alertAccess.unreadCount(accountId);
  }
  markNotificationRead(id: string, accountId: string) {
    return this.alertAccess.markRead(id, accountId);
  }
  /** UC-18 · Marcar todas como leídas. Devuelve cuántas se marcaron (idempotente). */
  markAllNotificationsRead(accountId: string): Promise<number> {
    return this.alertAccess.markAllRead(accountId);
  }

  // --- UC-18 · Web Push: suscripciones por cuenta, revocables; el push es adicional (§2.7) ---

  /** Config pública para que el cliente decida si ofrecer push (clave VAPID). */
  getPushConfig(): { enabled: boolean; publicKey: string | null } {
    const publicKey = this.pushTransport.getPublicKey();
    return { enabled: publicKey !== null, publicKey };
  }

  /** UC-18 flujo 1: el navegador aceptó el permiso y se suscribe. Idempotente por endpoint. */
  subscribePush(accountId: string, input: { endpoint: string; p256dh: string; auth: string }): Promise<PushSubscription> {
    return this.pushSubscriptions.upsertSubscription({ accountId, ...input });
  }

  listPushSubscriptions(accountId: string): Promise<PushSubscription[]> {
    return this.pushSubscriptions.listForAccount(accountId);
  }

  /** Revoca la suscripción de un endpoint (A1: el usuario apaga el push; la campana sigue). */
  unsubscribePush(accountId: string, endpoint: string): Promise<number> {
    return this.pushSubscriptions.removeByEndpoint(accountId, endpoint);
  }

  // --- helpers ---

  /** NFR-30: autoridad al tiempo de medición. Sin relación alguna: 403; llegada tardía: cuarentena. */
  private async classifyWrite(
    patientId: string,
    principal: AuthPrincipal,
    measuredAt: Date,
  ): Promise<'authorized' | 'quarantine'> {
    const authority = await this.permission.classifyClinicalWrite({
      accountId: principal.accountId,
      patientId,
      at: measuredAt,
    });
    if (authority === 'forbidden') {
      throw new ForbiddenException('Sin autoridad para registrar datos de este paciente');
    }
    return authority;
  }

  /**
   * UC-12 A3 (NFR-30): persiste la llegada tardía en cuarentena — nunca descarte silencioso —,
   * avisa al círculo (UC-18) y audita. Idempotente por operationId: el reintento no re-notifica.
   */
  private async quarantineAttempt(
    patientId: string,
    type: ClinicalRecordType,
    principal: AuthPrincipal,
    measuredAt: Date,
    data: Record<string, unknown>,
    operationId: string,
  ): Promise<RecordOutcome> {
    const existing = await this.quarantineAccess.findByOperationId(operationId);
    if (existing) return { outcome: 'quarantined', quarantined: existing };

    const pendingPush: PendingPush[] = [];
    const result = await this.tx.run(async (em) => {
      const item = await this.quarantineAccess.quarantine(
        { patientId, type, authorAccountId: principal.accountId, authorRole: principal.role, measuredAt, data },
        operationId,
        em,
      );
      pendingPush.push(
        await this.notifyCircle(em, patientId, principal.accountId, {
          alertId: null,
          type: 'quarantine',
          title: 'Registro en cuarentena',
          body: 'Llegó un registro tardío sin autorización vigente. Revisalo para aprobarlo o descartarlo.',
        }),
      );
      await this.audit.record({
        action: 'care-record.quarantined',
        actor: principal.accountId,
        target: { type: 'quarantined_record', id: item.id },
        metadata: { recordType: type, measuredAt, reason: 'no-authority-at-measurement' },
        manager: em,
      });
      return { outcome: 'quarantined', quarantined: item } as const;
    });
    await this.dispatchPush(pendingPush);
    return result;
  }

  /**
   * Evalúa cada valor contra su rango y, si está fuera, alerta al círculo (atómico con el registro).
   * El rango se resuelve con asOf = measuredAt del registro y el estrato etario del paciente a esa
   * fecha (NFR-17); la alerta persiste el id real de la versión aplicada (NFR-28). Como la
   * cuarentena aprobada re-evalúa con su measuredAt ORIGINAL, el replay es determinista (NFR-36).
   */
  private async evaluateVitalsAndAlert(
    em: EntityManager,
    patientId: string,
    record: ClinicalRecord,
    pendingPush: PendingPush[],
  ): Promise<void> {
    const values = (record.data as { values?: { metricKey: string; value: number }[] }).values ?? [];
    if (values.length === 0) return;

    // Lectura cross-dominio permitida: réplica de solo-lectura de Membership (constitution §3.5).
    const patient = await this.accountAccess.findPatientById(patientId);
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    const ageYears = ageInYearsAt(patient.birthDate, record.measuredAt);

    for (const v of values) {
      const range = await this.rangeAccess.getApplicableRange(v.metricKey, {
        ageYears,
        asOf: record.measuredAt,
      });
      const evaluation = this.alertEngine.evaluateVital(v.value, range);
      if (!evaluation.outOfRange) continue;

      const alert = await this.alertAccess.createAlert(
        {
          patientId,
          recordId: record.id,
          metricKey: v.metricKey,
          value: String(v.value),
          unit: range.unit,
          severity: evaluation.severity,
          rangeVersion: range.version,
          message: evaluation.message,
        },
        em,
      );
      pendingPush.push(
        await this.notifyCircle(em, patientId, record.authorAccountId, {
          alertId: alert.id,
          type: 'alert',
          title: 'Alerta clínica',
          body: evaluation.message,
        }),
      );
    }
  }

  /** UC-12 A3: solo consent-holder o manager resuelven; el item debe ser del paciente. */
  private async getResolvable(patientId: string, id: string, principal: AuthPrincipal): Promise<QuarantinedRecord> {
    const canResolve = await this.permission.hasLinkRole(
      { accountId: principal.accountId, patientId },
      ['consent-holder', 'manager'],
    );
    if (!canResolve) {
      throw new ForbiddenException('Solo el consent-holder o un manager del círculo resuelven la cuarentena');
    }
    const item = await this.quarantineAccess.findById(id);
    if (!item || item.patientId !== patientId) throw new NotFoundException('Item de cuarentena no encontrado');
    return item;
  }

  /**
   * Notifica a TODOS los familiares vinculados (incluido quien registró, salvo que se excluya).
   * La campana se persiste acá, DENTRO de la transacción (garantía §2.7); devuelve el push
   * pendiente para despachar recién después del commit — un push caído jamás toca la campana.
   */
  private async notifyCircle(
    em: EntityManager,
    patientId: string,
    _actorId: string,
    payload: { alertId: string | null; type: string; title: string; body: string },
  ): Promise<PendingPush> {
    const links = await this.accountAccess.listLinksForPatient(patientId);
    for (const link of links) {
      await this.alertAccess.createNotification(
        { recipientAccountId: link.accountId, patientId, ...payload },
        em,
      );
    }
    return {
      recipients: links.map((l) => l.accountId),
      payload: { type: payload.type, patientId, title: payload.title, body: payload.body },
    };
  }

  /**
   * UC-18 flujo 5: push best-effort a los suscriptos, después del commit. Cualquier falla se
   * loguea y se traga — la campana ya registró todo (constitution §2.7, NFR-09). Endpoints
   * muertos (404/410) se depuran acá.
   */
  private async dispatchPush(pending: PendingPush[]): Promise<void> {
    for (const p of pending) {
      try {
        const subscriptions = await this.pushSubscriptions.listForAccounts(p.recipients);
        if (subscriptions.length === 0) continue;
        const stale = await this.pushTransport.deliver(subscriptions, p.payload);
        await this.pushSubscriptions.removeStaleEndpoints(stale);
      } catch (err) {
        this.logger.warn(`Push no entregado (${(err as Error).message}); la campana ya registró la notificación`);
      }
    }
  }

  private resolveMeasuredAt(iso?: string): Date {
    if (!iso) return new Date();
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new UnprocessableEntityException('measuredAt inválido');
    return d;
  }
}
