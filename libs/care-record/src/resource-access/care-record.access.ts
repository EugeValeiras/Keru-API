import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { ClinicalRecord, ClinicalRecordType } from './entities/clinical-record.entity';

export interface RecordInput {
  patientId: string;
  type: ClinicalRecordType;
  authorAccountId: string;
  authorRole: string;
  measuredAt: Date;
  data: Record<string, unknown>;
  /** NFR-38: si el registro es una corrección, la versión que reemplaza + su razón. */
  supersedesRecordId?: string | null;
  correctionReason?: string | null;
}

/**
 * CareRecordAccess (constitution §3.1). Verbos atómicos sobre el path de escritura clínica.
 * Idempotente por operationId (NFR-34). El commit del registro + su obligación de alerta va en
 * una sola transacción (Decouple row 35) — orquestado por el Manager con el EntityManager de la tx.
 */
@ResourceAccess()
@Injectable()
export class CareRecordAccess {
  constructor(@InjectRepository(ClinicalRecord) private readonly records: Repository<ClinicalRecord>) {}

  async record(input: RecordInput, operationId: string, manager?: EntityManager): Promise<ClinicalRecord> {
    const repo = manager ? manager.getRepository(ClinicalRecord) : this.records;
    const existing = await repo.findOne({ where: { createdByOperationId: operationId } });
    if (existing) return existing;
    return repo.save(repo.create({ ...input, createdByOperationId: operationId }));
  }

  findByOperationId(operationId: string): Promise<ClinicalRecord | null> {
    return this.records.findOne({ where: { createdByOperationId: operationId } });
  }

  findById(id: string): Promise<ClinicalRecord | null> {
    return this.records.findOne({ where: { id } });
  }

  /**
   * NFR-38: marca al original como superseded por la corrección — solo si todavía es la versión
   * vigente (guard contra correcciones concurrentes; el original nunca se toca más que en estas
   * dos columnas de marca: append-only). Devuelve si lo logró.
   */
  // operation-identity: exempt — transición con precondición (supersededAt IS NULL) dentro de la
  // transacción de la corrección: el at-most-once lo da el operationId del verbo padre.
  async markSuperseded(id: string, byRecordId: string, manager: EntityManager): Promise<boolean> {
    const result = await manager
      .getRepository(ClinicalRecord)
      .createQueryBuilder()
      .update(ClinicalRecord)
      .set({ supersededAt: () => 'now()', supersededByRecordId: byRecordId })
      .where('id = :id', { id })
      .andWhere('"supersededAt" IS NULL')
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** Historial ordenado por tiempo de medición (NFR-36). Para CareConsult. */
  listForPatient(patientId: string): Promise<ClinicalRecord[]> {
    return this.records.find({ where: { patientId }, order: { measuredAt: 'DESC' } });
  }
}
