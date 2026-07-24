import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import {
  AvailabilitySlot,
  Caregiver,
  CaregiverStatus,
  Certification,
  Rates,
  VerificationBadges,
} from './entities/caregiver.entity';
import { CaregiverRateVersion } from './entities/caregiver-rate-version.entity';
import { Account } from './entities/account.entity';

export interface CreateCaregiverInput {
  accountId: string;
  specialties: string[];
  certifications: Certification[];
  availability: AvailabilitySlot[];
  rates: Rates;
  zone: string;
  modalities: string[];
}

/** UC-02 A2 · Datos corregidos de la re-postulación (el perfil ya existe; la cuenta no cambia). */
export type ResubmitCaregiverInput = Omit<CreateCaregiverInput, 'accountId'>;

/**
 * UC-02 A3 · Campos editables de un perfil aprobado (los que no requieren re-verificación).
 * La foto NO está acá (ADR-0003): la identidad vive en la `Account` (`PATCH /accounts/me`, UC-23).
 */
export interface UpdateApprovedProfileInput {
  availability?: AvailabilitySlot[];
  rates?: Rates;
  zone?: string;
  modalities?: string[];
}

/**
 * CaregiverAccess (constitution §3.1). Verbos atómicos sobre el perfil de cuidador: personas +
 * cuentas, perfiles, tarifas efectivo-fechadas, insignias + provenance, ciclo de aprobación,
 * visibilidad. Verbos mutantes idempotentes (NFR-34). Dueño: Membership.
 */
@ResourceAccess()
@Injectable()
export class CaregiverAccess {
  constructor(
    @InjectRepository(Caregiver) private readonly caregivers: Repository<Caregiver>,
    @InjectRepository(CaregiverRateVersion)
    private readonly rateVersions: Repository<CaregiverRateVersion>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
  ) {}

  /**
   * ADR-0003 · Resuelve la identidad (nombre/foto) del cuidador desde su `Account` por `accountId`
   * (join intra-Membership) y la proyecta sobre el perfil, que NO tiene columnas de identidad. Así
   * el marketplace/ficha muestran la misma identidad que el header. `displayName` cae a '' si la
   * cuenta no existe (no debería: un perfil siempre nace de una cuenta).
   */
  private async withIdentity<T extends Caregiver | null>(caregiver: T): Promise<T> {
    if (!caregiver) return caregiver;
    const [enriched] = await this.withIdentityMany([caregiver]);
    return enriched as T;
  }

  private async withIdentityMany(caregivers: Caregiver[]): Promise<Caregiver[]> {
    if (caregivers.length === 0) return caregivers;
    const accountIds = [...new Set(caregivers.map((c) => c.accountId))];
    const accounts = await this.accounts.find({ where: { id: In(accountIds) } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const c of caregivers) {
      const account = byId.get(c.accountId);
      c.displayName = account?.displayName ?? '';
      c.photoUrl = account?.photoUrl ?? null;
    }
    return caregivers;
  }

  /** UC-02. Idempotente por operationId; un perfil por cuenta. Las certificaciones nacen no verificadas. */
  async createProfile(input: CreateCaregiverInput, operationId: string): Promise<Caregiver> {
    const existing = await this.caregivers.findOne({ where: { createdByOperationId: operationId } });
    if (existing) return this.withIdentity(existing);

    const caregiver = this.caregivers.create({
      ...input,
      // Las certificaciones ya vienen construidas por el Manager (id, status pending, documentKey…).
      certifications: input.certifications,
      status: 'pending',
      badges: { certifications: false, identity: false, background: false },
      createdByOperationId: operationId,
    });
    return this.withIdentity(await this.caregivers.save(caregiver));
  }

  /**
   * KER-52 (UC-02 A4) · Agrega una certificación nueva (nace `pending`) al array del perfil.
   * Idempotente por `operationId` (NFR-34): si ya existe una cert con ese operationId, no la duplica.
   * Las certificaciones son jsonb embebido, por eso el append es read-modify-write acá.
   */
  async addCertification(
    caregiverId: string,
    certification: Certification,
    operationId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Caregiver) : this.caregivers;
    const caregiver = await repo.findOne({ where: { id: caregiverId } });
    if (!caregiver) return;
    const certs = caregiver.certifications ?? [];
    if (certs.some((c) => c.operationId && c.operationId === operationId)) return; // at-most-once
    certs.push(certification);
    await repo.update(caregiverId, { certifications: certs });
  }

  /**
   * KER-52 (UC-19) · Reemplaza el array de certificaciones (aprobar/rechazar por-cert). Set de
   * valores: naturalmente idempotente, no requiere operationId (NFR-34, aclaración). El Manager
   * arma el array ya mutado y lo persiste junto con las insignias en la misma llamada.
   */
  async setCertifications(
    caregiverId: string,
    certifications: Certification[],
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Caregiver) : this.caregivers;
    await repo.update(caregiverId, { certifications });
  }

  async findById(id: string): Promise<Caregiver | null> {
    return this.withIdentity(await this.caregivers.findOne({ where: { id } }));
  }

  async findByAccountId(accountId: string): Promise<Caregiver | null> {
    return this.withIdentity(await this.caregivers.findOne({ where: { accountId } }));
  }

  async listByStatus(status: CaregiverStatus): Promise<Caregiver[]> {
    return this.withIdentityMany(
      await this.caregivers.find({ where: { status }, order: { createdAt: 'ASC' } }),
    );
  }

  /**
   * Listado paginado con filtro por estado y búsqueda por nombre/zona (back-office). El nombre vive
   * en la `Account` (ADR-0003): se filtra por join intra-Membership con `account` por `accountId`.
   */
  async listPaged(
    status: CaregiverStatus | undefined,
    q: string | undefined,
    skip: number,
    take: number,
  ): Promise<[Caregiver[], number]> {
    const qb = this.caregivers
      .createQueryBuilder('c')
      .orderBy('c.createdAt', 'DESC')
      .skip(skip)
      .take(take);
    if (status) qb.andWhere('c.status = :status', { status });
    if (q) {
      qb.andWhere(
        '(c.zone ILIKE :q OR EXISTS (SELECT 1 FROM "account" a WHERE a.id = c."accountId" AND a."displayName" ILIKE :q))',
        { q: `%${q}%` },
      );
    }
    const [rows, count] = await qb.getManyAndCount();
    return [await this.withIdentityMany(rows), count];
  }

  /** Conteo de cuidadores por estado (dashboard). */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.caregivers
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.status')
      .getRawMany<{ status: string; count: string }>();
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }

  /** UC-19. Transición de estado con provenance (quién/cuándo). */
  async setStatus(
    id: string,
    status: CaregiverStatus,
    reviewedBy: string,
    rejectionReason: string | null,
    reviewedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Caregiver) : this.caregivers;
    await repo.update(id, { status, reviewedBy, reviewedAt, rejectionReason });
  }

  /** UC-19. Actualiza las insignias de verificación (los tres niveles son independientes). */
  async setBadges(id: string, badges: VerificationBadges, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(Caregiver) : this.caregivers;
    await repo.update(id, { badges });
  }

  /**
   * UC-02 A2 · Re-postulación tras rechazo: actualiza los datos corregidos, vuelve el perfil a
   * `pending`, limpia el motivo de rechazo y la provenance de revisión, y las certificaciones
   * vuelven a "no verificada". Transición con precondición (rejected -> pending, la valida el
   * Manager): naturalmente idempotente, no requiere operationId (NFR-34, aclaración).
   */
  /**
   * UC-02 A3 · Set parcial de los campos editables del perfil aprobado (la precondición de estado
   * la valida el Manager). Set de valores: naturalmente idempotente, no requiere operationId
   * (NFR-34, aclaración). No toca status ni credenciales.
   */
  async updateApprovedProfile(
    caregiverId: string,
    patch: UpdateApprovedProfileInput,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Caregiver) : this.caregivers;
    await repo.update(caregiverId, patch);
  }

  /**
   * UC-02 A3 · Agrega una versión efectivo-fechada de la tarifa (NFR-03/23). Append-only: nunca
   * modifica versiones pasadas. Idempotente por operationId.
   */
  async createRateVersion(
    caregiverId: string,
    rates: Rates,
    effectiveFrom: Date,
    operationId: string,
    manager?: EntityManager,
  ): Promise<CaregiverRateVersion> {
    const repo = manager ? manager.getRepository(CaregiverRateVersion) : this.rateVersions;
    const existing = await repo.findOne({ where: { createdByOperationId: operationId } });
    if (existing) return existing;
    return repo.save(repo.create({ caregiverId, rates, effectiveFrom, createdByOperationId: operationId }));
  }

  /** UC-02 A3 · Historial de tarifas en orden de vigencia (solo lectura; la historia no se reescribe). */
  listRateVersions(caregiverId: string): Promise<CaregiverRateVersion[]> {
    return this.rateVersions.find({ where: { caregiverId }, order: { effectiveFrom: 'ASC' } });
  }

  async resubmitProfile(caregiverId: string, input: ResubmitCaregiverInput): Promise<void> {
    // Identidad (nombre/foto) no vive acá (ADR-0003): se gestiona por la cuenta (UC-23).
    // Las certificaciones ya vienen reconstruidas por el Manager (nuevas, pending).
    await this.caregivers.update(caregiverId, {
      specialties: input.specialties,
      certifications: input.certifications,
      availability: input.availability,
      rates: input.rates,
      zone: input.zone,
      modalities: input.modalities,
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
    });
  }
}
