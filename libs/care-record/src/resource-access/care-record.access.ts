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

  /** Historial ordenado por tiempo de medición (NFR-36). Para CareConsult. */
  listForPatient(patientId: string): Promise<ClinicalRecord[]> {
    return this.records.find({ where: { patientId }, order: { measuredAt: 'DESC' } });
  }
}
