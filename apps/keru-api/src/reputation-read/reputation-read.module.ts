import { Global, Injectable, Module } from '@nestjs/common';
import { OwnReview, REPUTATION_READER, RatingAggregate, ReputationReader } from '@keru/core';
import { ReputationModule, ReviewAccess } from '@keru/reputation';

/**
 * Adapter real del puerto ReputationReader (constitution §3.7, mismo patrón que
 * AuthorizationModule): expone los agregados de reseñas como réplica de
 * solo-lectura para dominios no-dueños (Hiring la usa en las cards de UC-06).
 * Vive en composición porque Reputation ya importa Hiring (elegibilidad) y un
 * import directo Hiring→Reputation crearía un ciclo de módulos.
 */
@Injectable()
export class KeruReputationReader implements ReputationReader {
  constructor(private readonly reviews: ReviewAccess) {}

  aggregatesFor(
    subjectType: 'caregiver' | 'patient',
    subjectIds: string[],
  ): Promise<Record<string, RatingAggregate>> {
    return this.reviews.aggregateMany(subjectType, subjectIds);
  }

  async myReviewsFor(
    requestIds: string[],
    authorAccountId: string,
  ): Promise<Record<string, OwnReview>> {
    const reviews = await this.reviews.listByRequestsAndAuthor(requestIds, authorAccountId);
    return Object.fromEntries(
      reviews.map((r) => [r.requestId, { rating: r.rating, comment: r.comment }]),
    );
  }
}

@Global()
@Module({
  imports: [ReputationModule],
  providers: [KeruReputationReader, { provide: REPUTATION_READER, useExisting: KeruReputationReader }],
  exports: [REPUTATION_READER],
})
export class ReputationReadModule {}
