import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/**
 * TransactionUtility (constitution §3.1). Utility de infraestructura que define un límite de
 * transacción atómica. Un Manager la usa para orquestar operaciones atómicas (p. ej. registro
 * clínico + obligación de alerta, Decouple row 35) SIN tocar `DataSource` crudo ni correr queries:
 * dentro del `run`, todo acceso a datos sigue pasando por ResourceAccess (constitution §3.6).
 *
 * El `EntityManager` que recibe el callback es el contexto de la transacción; se pasa a los verbos
 * de ResourceAccess para que escriban dentro de la misma transacción.
 */
@Injectable()
export class TransactionUtility {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  run<T>(work: (ctx: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
