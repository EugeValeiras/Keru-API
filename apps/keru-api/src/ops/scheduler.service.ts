import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HiringManager } from '@keru/hiring';
import { ReputationManager } from '@keru/reputation';

/**
 * SchedulerService (NFR-14). Dispara los barridos de vencidos con `@nestjs/schedule`.
 * Vive en la capa de composición, separado de los Managers (que exponen el workflow de dominio).
 *
 * Multi-instancia: el @Cron corre en CADA instancia, pero los barridos usan el claim pattern
 * (UPDATE...RETURNING en el ResourceAccess), así cada fila la transiciona una sola instancia y los
 * efectos secundarios se hacen solo sobre las filas reclamadas. No hace falta lock ni leader.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly hiring: HiringManager,
    private readonly reputation: ReputationManager,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    const lifecycle = await this.hiring.sweepLifecycle();
    const reviews = await this.reputation.sweepReviewWindows();
    if (lifecycle.assignmentsClosed || lifecycle.requestsExpired || reviews.revealed) {
      this.logger.log(
        `Barrido: ${lifecycle.assignmentsClosed} asignaciones cerradas, ${lifecycle.requestsExpired} solicitudes expiradas, ${reviews.revealed} reseñas reveladas`,
      );
    }
  }
}
