import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import {
  HiringRequest,
  HiringRequestStatus,
  HiringTerminalReason,
} from './entities/hiring-request.entity';
import { Assignment } from './entities/assignment.entity';

export interface CreateRequestInput {
  patientId: string;
  requesterAccountId: string;
  caregiverId: string;
  modality: string;
  startDate: Date;
  endDate: Date;
  specialRequirements?: string | null;
  contactData: Record<string, unknown>;
  ratePerHourSnapshot: string;
  currencySnapshot: string;
}

/**
 * HiringAccess (constitution §3.1). Verbos atómicos sobre la máquina de estados de la
 * contratación: solicitudes (términos pinneados), aceptación, activación de asignación,
 * historial. Idempotente por operationId (NFR-34). Dueño de escritura: Hiring.
 */
@ResourceAccess()
@Injectable()
export class HiringAccess {
  constructor(
    @InjectRepository(HiringRequest) private readonly requests: Repository<HiringRequest>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
  ) {}

  // --- Solicitudes ---

  async submitRequest(input: CreateRequestInput, operationId: string): Promise<HiringRequest> {
    const existing = await this.requests.findOne({ where: { createdByOperationId: operationId } });
    if (existing) return existing;
    return this.requests.save(
      this.requests.create({ ...input, status: 'pending', createdByOperationId: operationId }),
    );
  }

  findRequestById(id: string): Promise<HiringRequest | null> {
    return this.requests.findOne({ where: { id } });
  }

  listRequestsForCaregiver(caregiverId: string): Promise<HiringRequest[]> {
    return this.requests.find({ where: { caregiverId }, order: { createdAt: 'DESC' } });
  }

  listRequestsForRequester(requesterAccountId: string): Promise<HiringRequest[]> {
    return this.requests.find({ where: { requesterAccountId }, order: { createdAt: 'DESC' } });
  }

  async setRequestStatus(
    id: string,
    status: HiringRequestStatus,
    decidedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(HiringRequest) : this.requests;
    await repo.update(id, { status, decidedAt });
  }

  /** Cierre del servicio con razón terminal estructurada (Decouple row 49): el porqué viaja con el estado. */
  async closeRequest(
    id: string,
    reason: HiringTerminalReason,
    decidedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(HiringRequest) : this.requests;
    await repo.update(id, { status: 'completed', terminalReason: reason, decidedAt });
  }

  /**
   * KER-32 · Cierre de la asignación ACTIVA (cancelación / no-show) con precondición SQL de
   * estado: solo transiciona desde `accepted`/`in-progress`. At-most-once por la precondición
   * (dos actores cancelando a la vez: solo uno gana; el reintento devuelve false y no reescribe
   * la razón). Devuelve true si esta llamada ejecutó el cierre.
   */
  async closeActiveRequest(
    id: string,
    reason: HiringTerminalReason,
    decidedAt: Date,
    noShowReportedAt: Date | null,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(HiringRequest) : this.requests;
    const result = await repo
      .createQueryBuilder()
      .update(HiringRequest)
      .set({ status: 'completed', terminalReason: reason, decidedAt, noShowReportedAt })
      .where('id = :id', { id })
      .andWhere('status IN (:...active)', { active: ['accepted', 'in-progress'] })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Honor-mark de pago (OQ-1): set-una-sola-vez por precondición `paidDeclaredAt IS NULL`
   * (at-most-once sin operationId, NFR-34). Devuelve true si esta llamada lo registró.
   */
  async declareRequestPaid(id: string, paidDeclaredAt: Date): Promise<boolean> {
    const result = await this.requests.update(
      { id, paidDeclaredAt: IsNull() },
      { paidDeclaredAt },
    );
    return (result.affected ?? 0) > 0;
  }

  // --- Asignaciones ---

  activateAssignment(
    input: { caregiverId: string; patientId: string; requestId: string; periodStart: Date; periodEnd: Date; provenance: string },
    manager?: EntityManager,
  ): Promise<Assignment> {
    const repo = manager ? manager.getRepository(Assignment) : this.assignments;
    return repo.save(repo.create({ ...input, status: 'active' }));
  }

  /** NFR-35: asignaciones activas del cuidador para revalidar conflictos al aceptar. */
  listActiveAssignmentsForCaregiver(caregiverId: string): Promise<Assignment[]> {
    return this.assignments.find({ where: { caregiverId, status: 'active' } });
  }

  /** UC-16: cuidadores (vigentes e históricos) de un paciente. */
  listAssignmentsForPatient(patientId: string): Promise<Assignment[]> {
    return this.assignments.find({ where: { patientId }, order: { createdAt: 'DESC' } });
  }

  // --- Métricas (dashboard) ---
  async countRequestsByStatus(): Promise<Record<string, number>> {
    const rows = await this.requests
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.status')
      .getRawMany<{ status: string; count: string }>();
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }

  countActiveAssignments(): Promise<number> {
    return this.assignments.count({ where: { status: 'active' } });
  }

  /** Cierre del servicio (UC-09/OQ-1): las asignaciones de la solicitud pasan a históricas. */
  async setAssignmentsHistoricalForRequest(requestId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(Assignment) : this.assignments;
    await repo.update({ requestId }, { status: 'historical' });
  }

  // --- Barrido de vencidos (NFR-14) · claim pattern: UPDATE...RETURNING (multi-instancia-safe) ---

  /** Asignaciones vencidas: active + periodEnd < now -> historical. Devuelve SOLO las que reclamó. */
  async claimDueAssignments(now: Date): Promise<Assignment[]> {
    const result = await this.assignments
      .createQueryBuilder()
      .update(Assignment)
      .set({ status: 'historical' })
      .where('status = :active', { active: 'active' })
      .andWhere('"periodEnd" < :now', { now })
      .returning('*')
      .execute();
    return result.raw as Assignment[];
  }

  // --- Ripple de desactivación de cuidador (NFR-31) ---

  /** Cierra las asignaciones activas del cuidador -> historical. Devuelve las cerradas. */
  async closeActiveAssignmentsForCaregiver(caregiverId: string): Promise<Assignment[]> {
    const result = await this.assignments
      .createQueryBuilder()
      .update(Assignment)
      .set({ status: 'historical' })
      .where('"caregiverId" = :caregiverId', { caregiverId })
      .andWhere('status = :active', { active: 'active' })
      .returning('*')
      .execute();
    return result.raw as Assignment[];
  }

  /** Cancela (declined) las solicitudes pendientes del cuidador. Devuelve las canceladas. */
  async declinePendingRequestsForCaregiver(caregiverId: string, now: Date): Promise<HiringRequest[]> {
    const result = await this.requests
      .createQueryBuilder()
      .update(HiringRequest)
      .set({ status: 'declined', decidedAt: now })
      .where('"caregiverId" = :caregiverId', { caregiverId })
      .andWhere('status = :pending', { pending: 'pending' })
      .returning('*')
      .execute();
    return result.raw as HiringRequest[];
  }

  /**
   * KER-58 (UC-09 A5, NFR-14) · Servicios que entraron en ventana: `accepted` + `startDate <= now`
   * y aún no vencidos (`endDate > now`) -> `in-progress`. Transición naturalmente idempotente por la
   * precondición de estado (naturalmente idempotente, sin operationId — NFR-34/ADR-0002); claim
   * `UPDATE...RETURNING` para at-most-once multi-instancia. Devuelve SOLO las que reclamó.
   */
  async claimStartedRequests(now: Date): Promise<HiringRequest[]> {
    const result = await this.requests
      .createQueryBuilder()
      .update(HiringRequest)
      .set({ status: 'in-progress' })
      .where('status = :accepted', { accepted: 'accepted' })
      .andWhere('"startDate" <= :now', { now })
      .andWhere('"endDate" > :now', { now })
      .returning('*')
      .execute();
    return result.raw as HiringRequest[];
  }

  /**
   * KER-58 (UC-09 A5, NFR-14) · Servicios cuya ventana terminó: `accepted`/`in-progress` +
   * `endDate < now` -> `completed` con razón terminal `completed` (cierre normal por cumplimiento
   * del período, Decouple row 49). La precondición SQL de estado **excluye** los ya cerrados por
   * cancelación/no-show (KER-31/32) — no reescribe su razón — y hace la transición naturalmente
   * idempotente (NFR-34). Claim `UPDATE...RETURNING` para at-most-once multi-instancia. Devuelve SOLO
   * las que reclamó.
   */
  async claimEndedRequests(now: Date): Promise<HiringRequest[]> {
    const result = await this.requests
      .createQueryBuilder()
      .update(HiringRequest)
      .set({ status: 'completed', terminalReason: 'completed', decidedAt: now })
      .where('status IN (:...active)', { active: ['accepted', 'in-progress'] })
      .andWhere('"endDate" < :now', { now })
      .returning('*')
      .execute();
    return result.raw as HiringRequest[];
  }

  /** Solicitudes pendientes vencidas: pending + startDate < now -> expired. Devuelve las reclamadas. */
  async claimExpiredPendingRequests(now: Date): Promise<HiringRequest[]> {
    const result = await this.requests
      .createQueryBuilder()
      .update(HiringRequest)
      .set({ status: 'expired', decidedAt: now })
      .where('status = :pending', { pending: 'pending' })
      .andWhere('"startDate" < :now', { now })
      .returning('*')
      .execute();
    return result.raw as HiringRequest[];
  }
}
