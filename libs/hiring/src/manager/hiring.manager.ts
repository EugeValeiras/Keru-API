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
  PubSubUtility,
  DomainEventType,
} from '@keru/core';
import { AccountAccess, CaregiverAccess, Caregiver } from '@keru/membership';
import { MatchingEngine, SearchFilters } from '../engine/matching.engine';
import { HiringAccess } from '../resource-access/hiring.access';
import { FavoriteAccess } from '../resource-access/favorite.access';
import {
  HiringRequest,
  HiringTerminalReason,
} from '../resource-access/entities/hiring-request.entity';
import { Assignment } from '../resource-access/entities/assignment.entity';
import { CreateRequestDto } from './dto/create-request.dto';
import { CancelActiveDto, RecordNoShowDto } from './dto/cancel-active.dto';
import { RehireRequestDto } from './dto/rehire-request.dto';

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

export interface RehireResult {
  request: HiringRequest;
  /** Tarifa pinneada de la última contratación previa con ese cuidador (diff NFR-23). */
  previousRatePerHour: string;
}

/** Parámetros internos del cierre de asignación activa (UC-09 A3/A4, KER-32). */
interface CloseActiveOptions {
  actorAccountId: string;
  reason: HiringTerminalReason;
  operationId: string;
  note: string | null;
  noShowReportedAt?: Date;
  /** Cuentas a notificar por campana (la contraparte; ambas si cancela el admin). */
  recipientAccountIds: string[];
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
    private readonly pubsub: PubSubUtility,
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
    return this.submitNewRequest(dto, requesterAccountId, 'hiring.request.created', {});
  }

  // --- UC-16 A2 · Rehire urgente (KER-32, NFR-15/23) ---
  /**
   * Re-solicitud dirigida a un cuidador que ya atendió al paciente, sin re-búsqueda. Re-pinnea
   * la tarifa vigente (NFR-03/21) y devuelve la pinneada de la última contratación previa para
   * el diff a la vista (NFR-23). Después sigue el ciclo normal (UC-10: el cuidador acepta).
   */
  async createRehireRequest(dto: RehireRequestDto, requesterAccountId: string): Promise<RehireResult> {
    await this.assertLinked(dto.patientId, requesterAccountId);
    // Precondición del rehire: asignación previa (vigente o histórica) con ese paciente.
    const assignments = await this.hiringAccess.listAssignmentsForPatient(dto.patientId);
    const prior = assignments.filter((a) => a.caregiverId === dto.caregiverId);
    if (prior.length === 0) {
      throw new BadRequestException(
        'El rehire urgente solo aplica a un cuidador que ya atendió al paciente (UC-16 A2)',
      );
    }
    // Tarifa anterior: la pinneada en la solicitud de la asignación previa más reciente.
    const lastRequestId = prior.find((a) => a.requestId)?.requestId ?? null;
    const previous = lastRequestId ? await this.hiringAccess.findRequestById(lastRequestId) : null;

    const request = await this.submitNewRequest(dto, requesterAccountId, 'hiring.request.rehire-created', {
      previousRatePerHour: previous?.ratePerHourSnapshot ?? null,
    });
    return { request, previousRatePerHour: previous?.ratePerHourSnapshot ?? request.ratePerHourSnapshot };
  }

  /** Alta de solicitud (UC-09 y rehire UC-16 A2): valida, pinnea términos vigentes y audita. */
  private async submitNewRequest(
    dto: CreateRequestDto,
    requesterAccountId: string,
    auditAction: string,
    extraMetadata: Record<string, unknown>,
  ): Promise<HiringRequest> {
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
      action: auditAction,
      actor: requesterAccountId,
      target: { type: 'hiring_request', id: request.id },
      metadata: { patientId: dto.patientId, caregiverId: dto.caregiverId, ...extraMetadata },
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

  // --- UC-09 A3 · Cancelación de la asignación ACTIVA por actor (KER-32, NFR-15, stressor #27) ---

  /** El solicitante cancela la asignación activa; se notifica al cuidador por campana. */
  async cancelActiveByRequester(
    requestId: string,
    requesterAccountId: string,
    dto: CancelActiveDto,
  ): Promise<HiringRequest> {
    const request = await this.requireActiveRequest(requestId);
    if (request.requesterAccountId !== requesterAccountId) {
      throw new ForbiddenException('Solo el solicitante puede cancelar su contratación');
    }
    const caregiver = await this.caregiverAccess.findById(request.caregiverId);
    return this.closeActiveAssignment(request, {
      actorAccountId: requesterAccountId,
      reason: 'cancelled-by-requester',
      operationId: dto.operationId,
      note: dto.note ?? null,
      recipientAccountIds: caregiver ? [caregiver.accountId] : [],
    });
  }

  /** El cuidador cancela la asignación activa; se notifica al solicitante por campana. */
  async cancelActiveByCaregiver(
    requestId: string,
    caregiverAccountId: string,
    dto: CancelActiveDto,
  ): Promise<HiringRequest> {
    const caregiver = await this.requireCaregiverByAccount(caregiverAccountId);
    const request = await this.requireActiveRequest(requestId);
    if (request.caregiverId !== caregiver.id) {
      throw new ForbiddenException('La solicitud no es de este cuidador');
    }
    return this.closeActiveAssignment(request, {
      actorAccountId: caregiverAccountId,
      reason: 'cancelled-by-caregiver',
      operationId: dto.operationId,
      note: dto.note ?? null,
      recipientAccountIds: [request.requesterAccountId],
    });
  }

  /** Un admin (soporte) cancela la asignación activa; se notifica a ambas partes por campana. */
  async cancelActiveByAdmin(
    requestId: string,
    adminAccountId: string,
    dto: CancelActiveDto,
  ): Promise<HiringRequest> {
    const request = await this.requireActiveRequest(requestId);
    const caregiver = await this.caregiverAccess.findById(request.caregiverId);
    return this.closeActiveAssignment(request, {
      actorAccountId: adminAccountId,
      reason: 'cancelled-by-admin',
      operationId: dto.operationId,
      note: dto.note ?? null,
      recipientAccountIds: [
        request.requesterAccountId,
        ...(caregiver ? [caregiver.accountId] : []),
      ],
    });
  }

  // --- UC-09 A4 · No-show del cuidador, registrado por el solicitante (KER-32, NFR-15) ---
  async recordNoShow(
    requestId: string,
    requesterAccountId: string,
    dto: RecordNoShowDto,
  ): Promise<HiringRequest> {
    const request = await this.requireActiveRequest(requestId);
    if (request.requesterAccountId !== requesterAccountId) {
      throw new ForbiddenException('Solo el solicitante puede registrar el no-show');
    }
    const caregiver = await this.caregiverAccess.findById(request.caregiverId);
    return this.closeActiveAssignment(request, {
      actorAccountId: requesterAccountId,
      reason: 'no-show',
      operationId: dto.operationId,
      note: dto.note ?? null,
      noShowReportedAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      recipientAccountIds: caregiver ? [caregiver.accountId] : [],
    });
  }

  /** Precondición común de A3/A4: la solicitud existe y tiene asignación activa. */
  private async requireActiveRequest(requestId: string): Promise<HiringRequest> {
    const request = await this.hiringAccess.findRequestById(requestId);
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.status !== 'accepted' && request.status !== 'in-progress') {
      throw new BadRequestException(`No hay asignación activa que cerrar (estado ${request.status})`);
    }
    return request;
  }

  /**
   * Cierre común de la asignación activa (A3/A4): en UNA transacción cierra la solicitud con su
   * razón terminal (precondición SQL de estado: at-most-once, NFR-34), historifica la asignación,
   * audita y publica `hiring.assignment.closed` en el outbox; la campana a la contraparte la
   * escribe CareRecord al consumir el evento (Manager→Manager solo encolado, constitution §3.2).
   */
  private async closeActiveAssignment(
    request: HiringRequest,
    opts: CloseActiveOptions,
  ): Promise<HiringRequest> {
    const decidedAt = new Date();
    const event = await this.tx.run(async (em) => {
      const closed = await this.hiringAccess.closeActiveRequest(
        request.id,
        opts.reason,
        decidedAt,
        opts.noShowReportedAt ?? null,
        em,
      );
      if (!closed) {
        // Perdió la carrera contra otro cierre: no reescribe la razón ni duplica efectos.
        throw new BadRequestException('La asignación ya fue cerrada por otra operación');
      }
      await this.hiringAccess.setAssignmentsHistoricalForRequest(request.id, em);
      await this.audit.record({
        action: opts.reason === 'no-show' ? 'hiring.request.no-show' : `hiring.assignment.${opts.reason}`,
        actor: opts.actorAccountId,
        target: { type: 'hiring_request', id: request.id },
        metadata: {
          terminalReason: opts.reason,
          operationId: opts.operationId,
          ...(opts.note ? { note: opts.note } : {}),
          ...(opts.noShowReportedAt ? { noShowReportedAt: opts.noShowReportedAt.toISOString() } : {}),
        },
        manager: em,
      });
      return this.pubsub.publish({
        manager: em,
        type: DomainEventType.AssignmentClosed,
        operationId: opts.operationId,
        payload: {
          requestId: request.id,
          patientId: request.patientId,
          caregiverId: request.caregiverId,
          reason: opts.reason,
          note: opts.note,
          noShowReportedAt: opts.noShowReportedAt?.toISOString() ?? null,
          recipientAccountIds: opts.recipientAccountIds,
        },
      });
    });
    // Tras el commit se encola el dispatch (patrón outbox, igual que la desactivación NFR-31).
    await this.pubsub.enqueue(event);
    return (await this.hiringAccess.findRequestById(request.id))!;
  }

  // --- UC-09 · Completar el servicio: cierre con razón terminal, independiente del pago (Decouple row 49) ---
  async completeRequest(requestId: string, requesterAccountId: string): Promise<HiringRequest> {
    const request = await this.hiringAccess.findRequestById(requestId);
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.requesterAccountId !== requesterAccountId) {
      throw new ForbiddenException('Solo el solicitante puede cerrar la contratación');
    }
    if (request.status !== 'accepted' && request.status !== 'in-progress') {
      throw new BadRequestException(`No se puede completar una solicitud en estado ${request.status}`);
    }
    await this.tx.run(async (em) => {
      await this.hiringAccess.closeRequest(request.id, 'completed', new Date(), em);
      await this.hiringAccess.setAssignmentsHistoricalForRequest(request.id, em);
      await this.audit.record({
        action: 'hiring.request.completed',
        actor: requesterAccountId,
        target: { type: 'hiring_request', id: request.id },
        metadata: { terminalReason: 'completed' },
        manager: em,
      });
    });
    return (await this.hiringAccess.findRequestById(request.id))!;
  }

  // --- UC-09 (OQ-1) · Declarar pagado: honor-mark opcional post-cierre (NFR-10/58) ---
  /** No condiciona el cierre ni la elegibilidad de reseña; set-una-sola-vez, re-declarar es no-op. */
  async declarePaid(requestId: string, requesterAccountId: string): Promise<HiringRequest> {
    const request = await this.hiringAccess.findRequestById(requestId);
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.requesterAccountId !== requesterAccountId) {
      throw new ForbiddenException('Solo el solicitante puede declarar el pago');
    }
    if (request.status !== 'completed') {
      throw new BadRequestException('El pago se declara sobre un servicio ya cerrado');
    }
    const declared = await this.hiringAccess.declareRequestPaid(request.id, new Date());
    if (declared) {
      await this.audit.record({
        action: 'hiring.request.paid-declared',
        actor: requesterAccountId,
        target: { type: 'hiring_request', id: request.id },
      });
    }
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
