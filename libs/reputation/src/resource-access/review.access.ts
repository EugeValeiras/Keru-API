import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { Review, ReviewSubject } from './entities/review.entity';

export interface CreateReviewInput {
  requestId: string;
  authorAccountId: string;
  subjectType: ReviewSubject;
  subjectId: string;
  rating: number;
  comment?: string | null;
}

export interface Aggregate {
  average: number;
  count: number;
}

/**
 * ReviewAccess (constitution §3.1). Verbos atómicos sobre reseñas selladas/reveladas inmutables,
 * y agregados sobre las reseñas visibles. Dueño de escritura: Reputation.
 */
@ResourceAccess()
@Injectable()
export class ReviewAccess {
  constructor(@InjectRepository(Review) private readonly reviews: Repository<Review>) {}

  // operation-identity: exempt — at-most-once por unique(requestId, authorAccountId)
  // (NFR-21: una reseña por servicio y autor, inmutable). El retry da conflicto, no duplica.
  create(input: CreateReviewInput): Promise<Review> {
    return this.reviews.save(this.reviews.create({ ...input, revealed: false }));
  }

  findByRequestAndAuthor(requestId: string, authorAccountId: string): Promise<Review | null> {
    return this.reviews.findOne({ where: { requestId, authorAccountId } });
  }

  /** Reseñas de un autor sobre N servicios en bloque (cards de UC-09/10 sin N+1). */
  listByRequestsAndAuthor(requestIds: string[], authorAccountId: string): Promise<Review[]> {
    if (requestIds.length === 0) return Promise.resolve([]);
    return this.reviews.find({ where: { requestId: In(requestIds), authorAccountId } });
  }

  /** La otra reseña del mismo servicio (contraparte). */
  findCounterpart(requestId: string, authorAccountId: string): Promise<Review | null> {
    return this.reviews.findOne({
      where: { requestId, authorAccountId: Not(authorAccountId) },
    });
  }

  /** Revela todas las reseñas de un servicio (reveal simultáneo, NFR-21). */
  async revealForRequest(requestId: string): Promise<void> {
    await this.reviews.update({ requestId }, { revealed: true });
  }

  /** Reseñas visibles (reveladas) de un sujeto (cuidador o paciente). */
  listRevealedForSubject(subjectType: ReviewSubject, subjectId: string): Promise<Review[]> {
    return this.reviews.find({
      where: { subjectType, subjectId, revealed: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Barrido de ventana de reveal (NFR-21: "…o cierra la ventana"). Claim pattern: revela las
   * reseñas selladas creadas antes de `before` y devuelve SOLO las que reclamó (multi-instancia-safe).
   */
  async claimReviewsToReveal(before: Date): Promise<Review[]> {
    const result = await this.reviews
      .createQueryBuilder()
      .update(Review)
      .set({ revealed: true })
      .where('revealed = false')
      .andWhere('"createdAt" < :before', { before })
      .returning('*')
      .execute();
    return result.raw as Review[];
  }

  /** Agregados en bloque para N sujetos (UC-06: rating en cards sin N+1). Solo reveladas (NFR-22). */
  async aggregateMany(
    subjectType: ReviewSubject,
    subjectIds: string[],
  ): Promise<Record<string, Aggregate>> {
    if (subjectIds.length === 0) {
      return {};
    }
    const rows = await this.reviews
      .createQueryBuilder('r')
      .select('r.subjectId', 'subjectId')
      .addSelect('AVG(r.rating)', 'average')
      .addSelect('COUNT(*)', 'count')
      .where('r.subjectType = :subjectType', { subjectType })
      .andWhere('r.revealed = true')
      .andWhere('r.subjectId IN (:...subjectIds)', { subjectIds })
      .groupBy('r.subjectId')
      .getRawMany<{ subjectId: string; average: string; count: string }>();
    return Object.fromEntries(
      rows.map((row) => [
        row.subjectId,
        { average: Math.round(Number(row.average) * 100) / 100, count: Number(row.count) },
      ]),
    );
  }

  /** Agregado sobre reseñas VISIBLES únicamente (NFR-22). */
  async aggregate(subjectType: ReviewSubject, subjectId: string): Promise<Aggregate> {
    const visible = await this.listRevealedForSubject(subjectType, subjectId);
    if (visible.length === 0) return { average: 0, count: 0 };
    const sum = visible.reduce((acc, r) => acc + r.rating, 0);
    return { average: Math.round((sum / visible.length) * 100) / 100, count: visible.length };
  }
}
