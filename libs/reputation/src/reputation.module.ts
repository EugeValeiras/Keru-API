import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MembershipModule } from '@keru/membership';
import { HiringModule } from '@keru/hiring';
import { Review } from './resource-access/entities/review.entity';
import { ReviewAccess } from './resource-access/review.access';
import { ReputationManager } from './manager/reputation.manager';
import { ReviewController } from './review.controller';

/**
 * Dominio Reputation (constitution §3). Reseñas bidireccionales familia↔cuidador. UC-17/21.
 * Dueño de escritura: reseñas. Lee solicitudes (Hiring) y cuidadores (Membership) para elegibilidad.
 */
@Module({
  imports: [MembershipModule, HiringModule, TypeOrmModule.forFeature([Review])],
  controllers: [ReviewController],
  providers: [ReviewAccess, ReputationManager],
  exports: [ReputationManager],
})
export class ReputationModule {}
