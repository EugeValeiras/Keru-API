import { Module } from '@nestjs/common';
import { HiringModule } from '@keru/hiring';
import { OutboxProcessor } from './outbox.processor';

/**
 * WorkerModule: consumidores de la cola del outbox (dispatch encolado Manager→Manager).
 * Vive en la capa de composición: importa los dominios suscriptores y despacha hacia ellos.
 */
@Module({
  imports: [HiringModule],
  providers: [OutboxProcessor],
})
export class WorkerModule {}
