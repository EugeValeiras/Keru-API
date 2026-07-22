import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { QuarantinedRecord, QuarantineStatus } from './entities/quarantined-record.entity';
import { RecordInput } from './care-record.access';

export interface ResolveQuarantineInput {
  status: Exclude<QuarantineStatus, 'pending'>;
  resolvedByAccountId: string;
  resolvedAt: Date;
  approvedRecordId?: string | null;
}

/**
 * QuarantineAccess (UC-12 A3, NFR-30). Verbos atómicos sobre la cuarentena de llegadas tardías
 * no autorizadas. La puesta en cuarentena es idempotente por operationId (NFR-34): el reintento
 * del mismo intento de sincronización no duplica el item.
 */
@ResourceAccess()
@Injectable()
export class QuarantineAccess {
  constructor(
    @InjectRepository(QuarantinedRecord) private readonly items: Repository<QuarantinedRecord>,
  ) {}

  async quarantine(input: RecordInput, operationId: string, manager?: EntityManager): Promise<QuarantinedRecord> {
    const repo = manager ? manager.getRepository(QuarantinedRecord) : this.items;
    const existing = await repo.findOne({ where: { createdByOperationId: operationId } });
    if (existing) return existing;
    return repo.save(repo.create({ ...input, createdByOperationId: operationId }));
  }

  findById(id: string): Promise<QuarantinedRecord | null> {
    return this.items.findOne({ where: { id } });
  }

  findByOperationId(operationId: string): Promise<QuarantinedRecord | null> {
    return this.items.findOne({ where: { createdByOperationId: operationId } });
  }

  /** Items del paciente, más recientes primero. Incluye resueltos: la traza no se borra. */
  listForPatient(patientId: string): Promise<QuarantinedRecord[]> {
    return this.items.find({ where: { patientId }, order: { receivedAt: 'DESC' } });
  }

  // operation-identity: exempt — transición de estado con precondición (pending) resuelta por el
  // Manager; re-aplicar la misma resolución es no-op natural (aclaración NFR-34).
  async resolve(id: string, outcome: ResolveQuarantineInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(QuarantinedRecord) : this.items;
    await repo.update(id, {
      status: outcome.status,
      resolvedByAccountId: outcome.resolvedByAccountId,
      resolvedAt: outcome.resolvedAt,
      approvedRecordId: outcome.approvedRecordId ?? null,
    });
  }
}
