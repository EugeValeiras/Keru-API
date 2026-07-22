import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Manager, AuditUtility, AuthPrincipal, PermissionEngine, TransactionUtility } from '@keru/core';
import { AccountAccess } from '@keru/membership';
import { CareRecordAccess } from '../resource-access/care-record.access';
import { RangeAccess } from '../resource-access/range.access';
import { AlertAccess } from '../resource-access/alert.access';
import { QuarantineAccess } from '../resource-access/quarantine.access';
import { AlertEngine } from '../engine/alert.engine';
import { ClinicalRecord, ClinicalRecordType } from '../resource-access/entities/clinical-record.entity';
import { QuarantinedRecord } from '../resource-access/entities/quarantined-record.entity';
import { RecordMedicationDto, RecordNoteDto, RecordVitalsDto } from './dto/record.dto';

/** Resultado de un registro clínico: entró al historial o quedó en cuarentena (NFR-30). */
export type RecordOutcome =
  | { outcome: 'recorded'; record: ClinicalRecord }
  | { outcome: 'quarantined'; quarantined: QuarantinedRecord };

/**
 * CareRecordManager (constitution §3.1). Orquesta capturar → evaluar → persistir → notificar.
 * Permiso al momento de la medición (NFR-30); plausibilidad (A1); commit atómico registro +
 * obligación de alerta (Decouple row 35); notificación al círculo (campana, I6).
 * Llegada tardía no autorizada → cuarentena, nunca descarte silencioso (UC-12 A3, NFR-30).
 */
@Manager()
@Injectable()
export class CareRecordManager {
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
  ) {}

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

    return this.tx.run(async (em) => {
      const record = await this.careRecordAccess.record(
        { patientId, type: 'vitals', authorAccountId: principal.accountId, authorRole, measuredAt, data: { values: dto.values } },
        dto.operationId,
        em,
      );

      await this.evaluateVitalsAndAlert(em, patientId, record);

      await this.audit.record({
        action: 'care-record.vitals.recorded',
        actor: principal.accountId,
        target: { type: 'clinical_record', id: record.id },
        metadata: { measuredAt },
        manager: em,
      });
      return { outcome: 'recorded', record } as const;
    });
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

    return this.tx.run(async (em) => {
      const record = await this.careRecordAccess.record(
        { patientId, type: 'note', authorAccountId: principal.accountId, authorRole, measuredAt, data: { text: dto.text } },
        dto.operationId,
        em,
      );
      // Una novedad notifica al círculo (UC-20 -> UC-18), como informativa.
      await this.notifyCircle(em, patientId, principal.accountId, {
        alertId: null,
        type: 'note',
        title: 'Nueva novedad',
        body: dto.text.slice(0, 300),
      });
      return { outcome: 'recorded', record } as const;
    });
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

    return this.tx.run(async (em) => {
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
      if (item.type === 'vitals') await this.evaluateVitalsAndAlert(em, patientId, record);

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

    return this.tx.run(async (em) => {
      const item = await this.quarantineAccess.quarantine(
        { patientId, type, authorAccountId: principal.accountId, authorRole: principal.role, measuredAt, data },
        operationId,
        em,
      );
      await this.notifyCircle(em, patientId, principal.accountId, {
        alertId: null,
        type: 'quarantine',
        title: 'Registro en cuarentena',
        body: 'Llegó un registro tardío sin autorización vigente. Revisalo para aprobarlo o descartarlo.',
      });
      await this.audit.record({
        action: 'care-record.quarantined',
        actor: principal.accountId,
        target: { type: 'quarantined_record', id: item.id },
        metadata: { recordType: type, measuredAt, reason: 'no-authority-at-measurement' },
        manager: em,
      });
      return { outcome: 'quarantined', quarantined: item } as const;
    });
  }

  /** Evalúa cada valor contra su rango y, si está fuera, alerta al círculo (atómico con el registro). */
  private async evaluateVitalsAndAlert(em: EntityManager, patientId: string, record: ClinicalRecord): Promise<void> {
    const values = (record.data as { values?: { metricKey: string; value: number }[] }).values ?? [];
    for (const v of values) {
      const range = this.rangeAccess.getApplicableRange(v.metricKey, patientId);
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
      await this.notifyCircle(em, patientId, record.authorAccountId, {
        alertId: alert.id,
        type: 'alert',
        title: 'Alerta clínica',
        body: evaluation.message,
      });
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

  /** Notifica a TODOS los familiares vinculados (incluido quien registró, salvo que se excluya). */
  private async notifyCircle(
    em: EntityManager,
    patientId: string,
    _actorId: string,
    payload: { alertId: string | null; type: string; title: string; body: string },
  ): Promise<void> {
    const links = await this.accountAccess.listLinksForPatient(patientId);
    for (const link of links) {
      await this.alertAccess.createNotification(
        { recipientAccountId: link.accountId, patientId, ...payload },
        em,
      );
    }
  }

  private resolveMeasuredAt(iso?: string): Date {
    if (!iso) return new Date();
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new UnprocessableEntityException('measuredAt inválido');
    return d;
  }
}
