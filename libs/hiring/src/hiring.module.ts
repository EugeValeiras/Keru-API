import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MembershipModule } from '@keru/membership';
import { HiringRequest } from './resource-access/entities/hiring-request.entity';
import { Assignment } from './resource-access/entities/assignment.entity';
import { Favorite } from './resource-access/entities/favorite.entity';
import { HiringAccess } from './resource-access/hiring.access';
import { FavoriteAccess } from './resource-access/favorite.access';
import { MatchingEngine } from './engine/matching.engine';
import { HiringManager } from './manager/hiring.manager';
import { MarketplaceController } from './marketplace.controller';
import { CaregiverRequestsController } from './caregiver-requests.controller';
import { AdminHiringController } from './admin-hiring.controller';

/**
 * Dominio Hiring (constitution §3). Marketplace: buscar, contratar, ciclo de vida + historial.
 * UC-05..10, UC-16. Dueño de escritura: solicitudes, asignaciones, favoritos.
 * Importa MembershipModule para leer cuidadores y vínculos como réplica de solo-lectura.
 */
@Module({
  imports: [
    MembershipModule,
    TypeOrmModule.forFeature([HiringRequest, Assignment, Favorite]),
  ],
  controllers: [MarketplaceController, CaregiverRequestsController, AdminHiringController],
  providers: [MatchingEngine, HiringAccess, FavoriteAccess, HiringManager],
  exports: [HiringAccess, HiringManager],
})
export class HiringModule {}
