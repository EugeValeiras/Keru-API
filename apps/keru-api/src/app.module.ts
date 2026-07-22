import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CoreModule } from '@keru/core';
import { AuthorizationModule } from './authorization/authorization.module';
import { OpsModule } from './ops/ops.module';
import { WorkerModule } from './worker/worker.module';
import { MembershipModule } from '@keru/membership';
import { HiringModule } from '@keru/hiring';
import { CareRecordModule } from '@keru/care-record';
import { CareConsultModule } from '@keru/care-consult';
import { ReputationModule } from '@keru/reputation';
import { ReferenceModule } from './reference/reference.module';

/**
 * Composición del monolito modular (constitution §3, §4): un solo deployable que compone
 * los 5 dominios por su API pública. Para separar un dominio por deploy, se crea un nuevo
 * apps/<dominio>-service que importa solo su módulo — sin reescribir dominio.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CoreModule,
    AuthorizationModule,
    MembershipModule,
    HiringModule,
    CareRecordModule,
    CareConsultModule,
    ReputationModule,
    ReferenceModule,
    OpsModule,
    WorkerModule,
  ],
})
export class AppModule {}
