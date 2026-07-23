import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Manager, AuditUtility } from '@keru/core';
import { CaregiverAccess } from '@keru/membership';
import { HiringAccess } from '@keru/hiring';
import { ReviewAccess, Aggregate } from '../resource-access/review.access';
import { Review, ReviewSubject } from '../resource-access/entities/review.entity';

export interface Reputation {
  aggregate: Aggregate;
  reviews: Review[];
}

/**
 * ReputationManager (constitution §3.1). Reseñas bidireccionales: elegibilidad por servicio
 * completado — la razón terminal `completed`, nunca el honor-mark de pago (NFR-20, Decouple
 * row 49) —, una por servicio (inmutable, I5), sellado hasta el reveal simultáneo (NFR-21),
 * agregados sobre reseñas visibles (NFR-22).
 */
@Manager()
@Injectable()
export class ReputationManager {
  constructor(
    private readonly reviewAccess: ReviewAccess,
    private readonly hiringAccess: HiringAccess,
    private readonly caregiverAccess: CaregiverAccess,
    private readonly audit: AuditUtility,
  ) {}

  /** UC-17 · El solicitante califica al cuidador de un servicio completado. */
  async reviewCaregiver(
    requestId: string,
    authorAccountId: string,
    rating: number,
    comment?: string,
  ): Promise<Review> {
    const request = await this.requireCompletedRequest(requestId);
    if (request.requesterAccountId !== authorAccountId) {
      throw new ForbiddenException('Solo el solicitante del servicio puede reseñar al cuidador');
    }
    return this.submit(requestId, authorAccountId, 'caregiver', request.caregiverId, rating, comment);
  }

  /** UC-21 · El cuidador califica al paciente de un servicio completado. */
  async reviewPatient(
    requestId: string,
    caregiverAccountId: string,
    rating: number,
    comment?: string,
  ): Promise<Review> {
    const request = await this.requireCompletedRequest(requestId);
    const caregiver = await this.caregiverAccess.findByAccountId(caregiverAccountId);
    if (!caregiver || caregiver.id !== request.caregiverId) {
      throw new ForbiddenException('Solo el cuidador del servicio puede reseñar al paciente');
    }
    return this.submit(requestId, caregiverAccountId, 'patient', request.patientId, rating, comment);
  }

  async getCaregiverReputation(caregiverId: string): Promise<Reputation> {
    return {
      aggregate: await this.reviewAccess.aggregate('caregiver', caregiverId),
      reviews: await this.reviewAccess.listRevealedForSubject('caregiver', caregiverId),
    };
  }

  async getPatientReputation(patientId: string): Promise<Reputation> {
    return {
      aggregate: await this.reviewAccess.aggregate('patient', patientId),
      reviews: await this.reviewAccess.listRevealedForSubject('patient', patientId),
    };
  }

  // --- NFR-21/14 · Barrido de ventana de reveal ---
  /** Revela reseñas selladas cuya ventana cerró (default 14 días). Idempotente. */
  async sweepReviewWindows(now = new Date(), windowDays = 14): Promise<{ revealed: number }> {
    const before = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const revealed = await this.reviewAccess.claimReviewsToReveal(before);
    for (const r of revealed) {
      await this.audit.record({
        action: 'reputation.review.window-revealed',
        actor: 'system',
        target: { type: 'review', id: r.id },
      });
    }
    return { revealed: revealed.length };
  }

  // --- helpers ---

  private async submit(
    requestId: string,
    authorAccountId: string,
    subjectType: ReviewSubject,
    subjectId: string,
    rating: number,
    comment?: string,
  ): Promise<Review> {
    const existing = await this.reviewAccess.findByRequestAndAuthor(requestId, authorAccountId);
    if (existing) throw new BadRequestException('Ya reseñaste este servicio (una sola vez, I5)');

    const review = await this.reviewAccess.create({
      requestId,
      authorAccountId,
      subjectType,
      subjectId,
      rating,
      comment: comment ?? null,
    });

    // Reveal simultáneo: si la contraparte ya reseñó, se revelan ambas (NFR-21).
    const counterpart = await this.reviewAccess.findCounterpart(requestId, authorAccountId);
    if (counterpart) await this.reviewAccess.revealForRequest(requestId);

    await this.audit.record({
      action: `reputation.review.${subjectType}`,
      actor: authorAccountId,
      target: { type: 'review', id: review.id },
      metadata: { requestId, revealed: !!counterpart },
    });

    return (await this.reviewAccess.findByRequestAndAuthor(requestId, authorAccountId))!;
  }

  /**
   * NFR-20: la elegibilidad la da la razón terminal `completed`; el honor-mark de pago no
   * participa. El estado `completed` significa "cerrado" (KER-31): un cierre por cancelación
   * o no-show (KER-32) comparte estado pero NO habilita reseñas — decide `terminalReason`.
   */
  private async requireCompletedRequest(requestId: string) {
    const request = await this.hiringAccess.findRequestById(requestId);
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.status !== 'completed' || request.terminalReason !== 'completed') {
      throw new BadRequestException('Solo se puede reseñar un servicio completado');
    }
    return request;
  }
}
