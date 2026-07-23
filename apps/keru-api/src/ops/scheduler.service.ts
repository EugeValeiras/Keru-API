import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CareRecordManager } from '@keru/care-record';
import { HiringManager } from '@keru/hiring';
import { ReputationManager } from '@keru/reputation';

/** Umbral de escalación de críticas no acusadas (KER-34, NFR-11): minutos sin acuse antes de re-notificar. */
const DEFAULT_ALERT_ESCALATION_MINUTES = 15;

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
    private readonly careRecord: CareRecordManager,
    private readonly config: ConfigService,
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

  /**
   * KER-34 (NFR-11/26) · Escalación de alertas críticas sin acuse: corre cada minuto para que el
   * umbral (ALERT_ESCALATION_MINUTES) se respete con precisión de minuto. Mismo claim pattern que
   * sweep(): cada alerta la escala UNA sola instancia; las superseded nunca se reclaman (anti-T7).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async escalateAlerts(): Promise<void> {
    const raw = Number(this.config.get('ALERT_ESCALATION_MINUTES', DEFAULT_ALERT_ESCALATION_MINUTES));
    const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ALERT_ESCALATION_MINUTES;
    const { escalated } = await this.careRecord.sweepAlertEscalation(minutes);
    if (escalated) {
      this.logger.log(`Escalación: ${escalated} alerta(s) crítica(s) sin acuse re-notificada(s) al círculo`);
    }
  }
}
