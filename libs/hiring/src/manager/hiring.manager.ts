import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Manager,
  AuditUtility,
  TransactionUtility,
  REPUTATION_READER,
  RatingAggregate,
  ReputationReader,
} from '@keru/core';
import { AccountAccess, CaregiverAccess, Caregiver } from '@keru/membership';
import { MatchingEngine, SearchFilters } from '../engine/matching.engine';
import { HiringAccess } from '../resource-access/hiring.access';
import { FavoriteAccess } from '../resource-access/favorite.access';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';
import { Assignment } from '../resource-access/entities/assignment.entity';
import { CreateRequestDto } from './dto/create-request.dto';

export interface CaregiverCardData {
  caregiver: Caregiver;
  isFavorite: boolean;
  rating: RatingAggregate;
}

export interface RequestWithNames {
  request: HiringRequest;
  patientName?: string;
  caregiverName?: string;
}

export interface AcceptResult {
  request: HiringRequest;
  assignment: Assignment;
}

/**
 * HiringManager (constitution §3.1). Orquesta el marketplace: búsqueda (MatchingEngine),
 * solicitudes por paciente con términos pinneados, aceptación con revalidación, y la máquina de
 * estados de la asignación. Lee cuidadores/vínculos de Membership (réplica); escribe hirings.
 */
@Manager()
@Injectable()
export class HiringManager {
  constructor(
    private readonly tx: TransactionUtility,
    private readonly matching: MatchingEngine,
    private readonly hiringAccess: HiringAccess,
    private readonly favoriteAccess: FavoriteAccess,
    private readonly caregiverAccess: CaregiverAccess,
    private readonly accountAccess: AccountAccess,
    private readonly audit: AuditUtility,
    @Inject(REPUTATION_READER) private readonly reputation: ReputationReader,
  ) {}

  // --- UC-06 · Buscar (cards con reputación visible desde el listado, criterio 3) ---
  async search(filters: SearchFilters, accountId: string): Promise<CaregiverCardData[]> {
    const results = await this.matching.match(filters);
    const favIds = new Set(await this.favoriteAccess.listCaregiverIds(accountId));
    const ratings = await this.reputation.aggregatesFor(
      'caregiver',
      results.map((c) => c.id),
    );
    return results.map((c) => ({
      caregiver: c,
      isFavorite: favIds.has(c.id),
      rating: ratings[c.id] ?? { average: 0, count: 0 },
    }));
  }

  // --- UC-07 · Ver perfil (solo aprobados son visibles) ---
  async getProfile(caregiverId: string): Promise<Caregiver> {
    const caregiver = await this.caregiverAccess.findById(caregiverId);
    if (!caregiver || caregiver.status !== 'approved') {
      throw new NotFoundException('Cuidador no disponible');
    }
    return caregiver;
  }

  // --- UC-08 · Favoritos ---
  async addFavorite(accountId: string, caregiverId: string): Promise<void> {
    await this.favoriteAccess.add(accountId, caregiverId);
  }
  async removeFavorite(accountId: string, caregiverId: string): Promise<void> {
    await this.favoriteAccess.remove(accountId, caregiverId);
  }
  async listFavorites(accountId: string): Promise<CaregiverCardData[]> {
    const ids = await this.favoriteAccess.listCaregiverIds(accountId);
    const caregivers = (
      await Promise.all(ids.map((id) => this.caregiverAccess.findById(id)))
    ).filter((c): c is Caregiver => c !== null);
    const ratings = await this.reputation.aggregatesFor(
      'caregiver',
      caregivers.map((c) => c.id),
    );
    return caregivers.map((c) => ({
      caregiver: c,
      isFavorite: true,
      rating: ratings[c.id] ?? { average: 0, count: 0 },
    }));
  }

  // --- UC-09 · Crear solicitud ---
  async createRequest(dto: CreateRequestDto, requesterAccountId: string): Promise<HiringRequest> {
    await this.assertLinked(dto.patientId, requesterAccountId);

    const caregiver = await this.caregiverAccess.findById(dto.caregiverId);
    if (!caregiver || caregiver.status !== 'approved') {
      throw new BadRequestException('Cuidador no disponible');
    }

    const request = await this.hiringAccess.submitRequest(
      {
        patientId: dto.patientId,
        requesterAccountId,
        caregiverId: dto.caregiverId,
        modality: dto.modality,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        specialRequirements: dto.specialRequirements ?? null,
        contactData: dto.contactData,
        // Términos pinneados al momento de solicitar (NFR-03/23).
        ratePerHourSnapshot: String(caregiver.rates.ratePerHour),
        currencySnapshot: caregiver.rates.currency,
      },
      dto.operationId,
    );

    await this.audit.record({
      action: 'hiring.request.created',
      actor: requesterAccountId,
      target: { type: 'hiring_request', id: request.id },
      metadata: { patientId: dto.patientId, caregiverId: dto.caregiverId },
    });
    return request;
  }

  async listMyRequests(requesterAccountId: string): Promise<RequestWithNames[]> {
    const requests = await this.hiringAccess.listRequestsForRequester(requesterAccountId);
    const names = await this.caregiverNames(requests.map((r) => r.caregiverId));
    return requests.map((r) => ({ request: r, caregiverName: names.get(r.caregiverId) }));
  }

  // --- UC-10 · Aceptar / rechazar (cuidador) ---
  async listRequestsForCaregiverAccount(caregiverAccountId: string): Promise<RequestWithNames[]> {
    const caregiver = await this.requireCaregiverByAccount(caregiverAccountId);
    const requests = await this.hiringAccess.listRequestsForCaregiver(caregiver.id);
    const names = await this.patientNames(requests.map((r) => r.patientId));
    return requests.map((r) => ({ request: r, patientName: names.get(r.patientId) }));
  }

  /** Nombres de pacientes por id (réplica de solo-lectura de Membership), deduplicado. */
  private async patientNames(patientIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(patientIds)];
    const pairs = await Promise.all(
      unique.map(
        async (id) =>
          [id, (await this.accountAccess.findPatientById(id))?.fullName ?? ''] as const,
      ),
    );
    return new Map(pairs.filter(([, name]) => name !== ''));
  }

  /** Nombres de cuidadores por id (réplica de solo-lectura de Membership), deduplicado. */
  private async caregiverNames(caregiverIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(caregiverIds)];
    const pairs = await Promise.all(
      unique.map(
        async (id) => [id, (await this.caregiverAccess.findById(id))?.displayName ?? ''] as const,
      ),
    );
    return new Map(pairs.filter(([, name]) => name !== ''));
  }

  async acceptRequest(requestId: string, caregiverAccountId: string): Promise<AcceptResult> {
    const { request, caregiver } = await this.requireOwnedPendingRequest(requestId, caregiverAccountId);

    // NFR-35: revalidación en el momento de aceptar (conflicto con asignaciones activas del mismo par).
    const active = await this.hiringAccess.listActiveAssignmentsForCaregiver(caregiver.id);
    if (active.some((a) => a.patientId === request.patientId)) {
      throw new BadRequestException('Ya existe una asignación activa con este paciente');
    }

    const assignment = await this.tx.run(async (em) => {
      await this.hiringAccess.setRequestStatus(request.id, 'accepted', new Date(), em);
      const created = await this.hiringAccess.activateAssignment(
        {
          caregiverId: caregiver.id,
          patientId: request.patientId,
          requestId: request.id,
          periodStart: request.startDate,
          periodEnd: request.endDate,
          provenance: 'acceptance',
        },
        em,
      );
      await this.audit.record({
        action: 'hiring.request.accepted',
        actor: caregiverAccountId,
        target: { type: 'assignment', id: created.id },
        metadata: { requestId: request.id },
        manager: em,
      });
      return created;
    });
    // TODO(CareRecord): emitir evento encolado hiring.assignment.activated (PubSubUtility).
    const updated = (await this.hiringAccess.findRequestById(request.id))!;
    return { request: updated, assignment };
  }

  async declineRequest(requestId: string, caregiverAccountId: string): Promise<HiringRequest> {
    const { request } = await this.requireOwnedPendingRequest(requestId, caregiverAccountId);
    await this.hiringAccess.setRequestStatus(request.id, 'declined', new Date());
    await this.audit.record({
      action: 'hiring.request.declined',
      actor: caregiverAccountId,
      target: { type: 'hiring_request', id: request.id },
    });
    return (await this.hiringAccess.findRequestById(request.id))!;
  }

  // --- UC-09 A2 · Cancelación por el solicitante (solo pendiente; estado terminal) ---
  async cancelRequest(requestId: string, requesterAccountId: string): Promise<HiringRequest> {
    const request = await this.hiringAccess.findRequestById(requestId);
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.requesterAccountId !== requesterAccountId) {
      throw new ForbiddenException('Solo el solicitante puede cancelar la solicitud');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException('Solo se puede cancelar una solicitud pendiente');
    }
    // Transición con precondición (pending -> cancelled): naturalmente idempotente, sin operationId (NFR-34).
    await this.hiringAccess.setRequestStatus(request.id, 'cancelled', new Date());
    await this.audit.record({
      action: 'hiring.request.cancelled',
      actor: requesterAccountId,
      target: { type: 'hiring_request', id: request.id },
    });
    return (await this.hiringAccess.findRequestById(request.id))!;
  }

  // --- UC-09 (OQ-1) · Completar / marcar pagado -> finaliza el servicio ---
  async completeRequest(requestId: string, requesterAccountId: string): Promise<HiringRequest> {
    const request = await this.hiringAccess.findRequestById(requestId);
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.requesterAccountId !== requesterAccountId) {
      throw new ForbiddenException('Solo el solicitante puede cerrar la contratación');
    }
    if (request.status !== 'accepted' && request.status !== 'in-progress') {
      throw new BadRequestException(`No se puede finalizar una solicitud en estado ${request.status}`);
    }
    await this.tx.run(async (em) => {
      await this.hiringAccess.setRequestStatus(request.id, 'finished', new Date(), em);
      await this.hiringAccess.setAssignmentsHistoricalForRequest(request.id, em);
      await this.audit.record({
        action: 'hiring.request.completed',
        actor: requesterAccountId,
        target: { type: 'hiring_request', id: request.id },
        manager: em,
      });
    });
    return (await this.hiringAccess.findRequestById(request.id))!;
  }

  // --- UC-16 · Historial de cuidadores del paciente ---
  async caregiverHistory(patientId: string, requesterAccountId: string): Promise<Array<{ assignment: Assignment; caregiverName: string }>> {
    await this.assertLinked(patientId, requesterAccountId);
    const assignments = await this.hiringAccess.listAssignmentsForPatient(patientId);
    return Promise.all(
      assignments.map(async (a) => {
        const c = await this.caregiverAccess.findById(a.caregiverId);
        return { assignment: a, caregiverName: c?.displayName ?? '' };
      }),
    );
  }

  // --- NFR-31 · Ripple de desactivación (lo dispara el worker del outbox, NO Membership directo) ---
  /** Un cuidador fue desactivado: cerrar sus asignaciones activas y cancelar sus solicitudes pendientes. */
  async handleCaregiverDeactivated(caregiverId: string): Promise<{ assignmentsClosed: number; requestsCancelled: number }> {
    const assignments = await this.hiringAccess.closeActiveAssignmentsForCaregiver(caregiverId);
    const requests = await this.hiringAccess.declinePendingRequestsForCaregiver(caregiverId, new Date());
    for (const a of assignments) {
      await this.audit.record({
        action: 'hiring.assignment.closed-by-deactivation',
        actor: 'system',
        target: { type: 'assignment', id: a.id },
        metadata: { caregiverId },
      });
    }
    for (const r of requests) {
      await this.audit.record({
        action: 'hiring.request.cancelled-by-deactivation',
        actor: 'system',
        target: { type: 'hiring_request', id: r.id },
        metadata: { caregiverId },
      });
    }
    return { assignmentsClosed: assignments.length, requestsCancelled: requests.length };
  }

  // --- NFR-14 · Barrido de vencidos (llamado por el scheduler o el endpoint de ops) ---
  /** Finaliza asignaciones vencidas y expira solicitudes pendientes vencidas. Idempotente. */
  async sweepLifecycle(now = new Date()): Promise<{ assignmentsClosed: number; requestsExpired: number }> {
    const assignments = await this.hiringAccess.claimDueAssignments(now);
    const requests = await this.hiringAccess.claimExpiredPendingRequests(now);

    for (const a of assignments) {
      await this.audit.record({
        action: 'hiring.assignment.auto-closed',
        actor: 'system',
        target: { type: 'assignment', id: a.id },
      });
    }
    for (const r of requests) {
      await this.audit.record({
        action: 'hiring.request.auto-expired',
        actor: 'system',
        target: { type: 'hiring_request', id: r.id },
      });
    }
    return { assignmentsClosed: assignments.length, requestsExpired: requests.length };
  }

  /** Métricas de contratación para el dashboard del back-office. */
  async dashboardMetrics(): Promise<{ requests: Record<string, number>; activeAssignments: number }> {
    const [requests, activeAssignments] = await Promise.all([
      this.hiringAccess.countRequestsByStatus(),
      this.hiringAccess.countActiveAssignments(),
    ]);
    return { requests, activeAssignments };
  }

  // --- helpers ---
  /** El solicitante debe estar vinculado al paciente. */
  private async assertLinked(patientId: string, accountId: string): Promise<void> {
    const link = await this.accountAccess.getLink(patientId, accountId);
    if (!link) throw new ForbiddenException('No estás vinculado a este paciente');
  }

  private async requireCaregiverByAccount(accountId: string): Promise<Caregiver> {
    const caregiver = await this.caregiverAccess.findByAccountId(accountId);
    if (!caregiver) throw new ForbiddenException('La cuenta no tiene perfil de cuidador');
    return caregiver;
  }

  private async requireOwnedPendingRequest(
    requestId: string,
    caregiverAccountId: string,
  ): Promise<{ request: HiringRequest; caregiver: Caregiver }> {
    const caregiver = await this.requireCaregiverByAccount(caregiverAccountId);
    const request = await this.hiringAccess.findRequestById(requestId);
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.caregiverId !== caregiver.id) {
      throw new ForbiddenException('La solicitud no es para este cuidador');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException(`La solicitud ya está en estado ${request.status}`);
    }
    return { request, caregiver };
  }
}
