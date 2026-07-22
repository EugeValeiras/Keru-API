import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import {
  AvailabilitySlot,
  Caregiver,
  CaregiverStatus,
  Certification,
  Rates,
  VerificationBadges,
} from './entities/caregiver.entity';

export interface CreateCaregiverInput {
  accountId: string;
  displayName: string;
  photoUrl?: string | null;
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
 * CaregiverAccess (constitution §3.1). Verbos atómicos sobre el perfil de cuidador: personas +
 * cuentas, perfiles, tarifas efectivo-fechadas, insignias + provenance, ciclo de aprobación,
 * visibilidad. Verbos mutantes idempotentes (NFR-34). Dueño: Membership.
 */
@ResourceAccess()
@Injectable()
export class CaregiverAccess {
  constructor(@InjectRepository(Caregiver) private readonly caregivers: Repository<Caregiver>) {}

  /** UC-02. Idempotente por operationId; un perfil por cuenta. Las certificaciones nacen no verificadas. */
  async createProfile(input: CreateCaregiverInput, operationId: string): Promise<Caregiver> {
    const existing = await this.caregivers.findOne({ where: { createdByOperationId: operationId } });
    if (existing) return existing;

    const caregiver = this.caregivers.create({
      ...input,
      certifications: input.certifications.map((c) => ({ ...c, verified: false })),
      status: 'pending',
      badges: { certifications: false, identity: false, background: false },
      createdByOperationId: operationId,
    });
    return this.caregivers.save(caregiver);
  }

  findById(id: string): Promise<Caregiver | null> {
    return this.caregivers.findOne({ where: { id } });
  }

  findByAccountId(accountId: string): Promise<Caregiver | null> {
    return this.caregivers.findOne({ where: { accountId } });
  }

  listByStatus(status: CaregiverStatus): Promise<Caregiver[]> {
    return this.caregivers.find({ where: { status }, order: { createdAt: 'ASC' } });
  }

  /** Listado paginado con filtro por estado y búsqueda por nombre/zona (back-office). */
  listPaged(
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
    if (q) qb.andWhere('(c."displayName" ILIKE :q OR c.zone ILIKE :q)', { q: `%${q}%` });
    return qb.getManyAndCount();
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
  async setBadges(id: string, badges: VerificationBadges): Promise<void> {
    await this.caregivers.update(id, { badges });
  }

  /**
   * UC-02 A2 · Re-postulación tras rechazo: actualiza los datos corregidos, vuelve el perfil a
   * `pending`, limpia el motivo de rechazo y la provenance de revisión, y las certificaciones
   * vuelven a "no verificada". Transición con precondición (rejected -> pending, la valida el
   * Manager): naturalmente idempotente, no requiere operationId (NFR-34, aclaración).
   */
  async resubmitProfile(caregiverId: string, input: ResubmitCaregiverInput): Promise<void> {
    await this.caregivers.update(caregiverId, {
      displayName: input.displayName,
      photoUrl: input.photoUrl ?? null,
      specialties: input.specialties,
      certifications: input.certifications.map((c) => ({ ...c, verified: false })),
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
