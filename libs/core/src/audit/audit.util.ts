import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditRecord {
  action: string;
  actor: string;
  target?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** Si se pasa, la traza se escribe dentro de esa transacción (atómica con el cambio). */
  manager?: EntityManager;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

/** AuditUtility: punto único para registrar trazas auditables (constitution §5, NFR-33). */
@Injectable()
export class AuditUtility {
  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  async record(entry: AuditRecord): Promise<void> {
    const repo = entry.manager ? entry.manager.getRepository(AuditLog) : this.repo;
    await repo.save(
      repo.create({
        action: entry.action,
        actor: entry.actor,
        target: entry.target ?? null,
        metadata: entry.metadata ?? null,
      }),
    );
  }

  /** Lectura del audit log para el back-office (NFR-33). Paginado, filtros opcionales. */
  async list(query: AuditQuery): Promise<{ items: AuditLog[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    const page = Math.max(query.page ?? 1, 1);
    const where: FindOptionsWhere<AuditLog> = {};
    if (query.actor) where.actor = query.actor;
    if (query.action) where.action = query.action;
    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }
}
