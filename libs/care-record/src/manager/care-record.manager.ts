import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Manager, AuditUtility, AuthPrincipal, PermissionEngine, TransactionUtility } from '@keru/core';
import { AccountAccess } from '@keru/membership';
import { CareRecordAccess } from '../resource-access/care-record.access';
import { RangeAccess } from '../resource-access/range.access';
import { AlertAccess } from '../resource-access/alert.access';
import { AlertEngine } from '../engine/alert.engine';
import { ClinicalRecord } from '../resource-access/entities/clinical-record.entity';
import { RecordMedicationDto, RecordNoteDto, RecordVitalsDto } from './dto/record.dto';

/**
 * CareRecordManager (constitution §3.1). Orquesta capturar → evaluar → persistir → notificar.
 * Permiso al momento de la medición (NFR-30); plausibilidad (A1); commit atómico registro +
 * obligación de alerta (Decouple row 35); notificación al círculo (campana, I6).
 */
@Manager()
@Injectable()
export class CareRecordManager {
  constructor(
    private readonly tx: TransactionUtility,
    private readonly careRecordAccess: CareRecordAccess,
    private readonly rangeAccess: RangeAccess,
    private readonly alertAccess: AlertAccess,
    private readonly alertEngine: AlertEngine,
    private readonly accountAccess: AccountAccess,
    private readonly permission: PermissionEngine,
    private readonly audit: AuditUtility,
  ) {}

  // --- UC-12 · Registrar signos vitales ---
  async recordVitals(patientId: string, dto: RecordVitalsDto, principal: AuthPrincipal): Promise<ClinicalRecord> {
    const measuredAt = this.resolveMeasuredAt(dto.measuredAt);
    await this.permission.assertCanRecordClinical({ accountId: principal.accountId, patientId, at: measuredAt });
    const authorRole = principal.role;

    const dup = await this.careRecordAccess.findByOperationId(dto.operationId);
    if (dup) return dup; // idempotente: no re-persiste ni re-alerta (NFR-34)

    // A1: rechazar valores implausibles (error de tipeo) antes de persistir.
    for (const v of dto.values) {
      const p = this.rangeAccess.getPlausible(v.metricKey);
      if (v.value < p.min || v.value > p.max) {
        throw new UnprocessableEntityException(
          `Valor implausible para ${v.metricKey}: ${v.value} ${p.unit}`,
        );
      }
    }

    return this.tx.run(async (em) => {
      const record = await this.careRecordAccess.record(
        { patientId, type: 'vitals', authorAccountId: principal.accountId, authorRole, measuredAt, data: { values: dto.values } },
        dto.operationId,
        em,
      );

      // Evaluar cada valor contra su rango y, si está fuera, alertar al círculo (atómico).
      for (const v of dto.values) {
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
        await this.notifyCircle(em, patientId, principal.accountId, {
          alertId: alert.id,
          type: 'alert',
          title: 'Alerta clínica',
          body: evaluation.message,
        });
      }

      await this.audit.record({
        action: 'care-record.vitals.recorded',
        actor: principal.accountId,
        target: { type: 'clinical_record', id: record.id },
        metadata: { measuredAt },
        manager: em,
      });
      return record;
    });
  }

  // --- UC-13 · Registrar medicación ---
  async recordMedication(patientId: string, dto: RecordMedicationDto, principal: AuthPrincipal): Promise<ClinicalRecord> {
    const measuredAt = this.resolveMeasuredAt(dto.measuredAt);
    await this.permission.assertCanRecordClinical({ accountId: principal.accountId, patientId, at: measuredAt });
    const authorRole = principal.role;
    return this.careRecordAccess.record(
      {
        patientId,
        type: 'medication',
        authorAccountId: principal.accountId,
        authorRole,
        measuredAt,
        data: { medication: dto.medication, dose: dto.dose, schedule: dto.schedule, observations: dto.observations },
      },
      dto.operationId,
    );
  }

  // --- UC-20 · Registrar novedad ---
  async recordNote(patientId: string, dto: RecordNoteDto, principal: AuthPrincipal): Promise<ClinicalRecord> {
    const measuredAt = this.resolveMeasuredAt(dto.measuredAt);
    await this.permission.assertCanRecordClinical({ accountId: principal.accountId, patientId, at: measuredAt });
    const authorRole = principal.role;

    const dup = await this.careRecordAccess.findByOperationId(dto.operationId);
    if (dup) return dup;

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
      return record;
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
