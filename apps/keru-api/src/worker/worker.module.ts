import { Module } from '@nestjs/common';
import { HiringModule } from '@keru/hiring';
import { CareRecordModule } from '@keru/care-record';
import { OutboxProcessor } from './outbox.processor';
import { OutboxReconciler } from './outbox.reconciler';

/**
 * WorkerModule: consumidores de la cola del outbox (dispatch encolado Manager→Manager).
 * Vive en la capa de composición: importa los dominios suscriptores y despacha hacia ellos.
 * KER-33: el processor reintenta con backoff y dead-letterea; el reconciler reencola huérfanos.
 */
@Module({
  imports: [HiringModule, CareRecordModule],
  providers: [OutboxProcessor, OutboxReconciler],
})
export class WorkerModule {}
