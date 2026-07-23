import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule, requestLoggerMiddleware, throttlerModuleOptions } from '@keru/core';
import { AuthorizationModule } from './authorization/authorization.module';
import { ReputationReadModule } from './reputation-read/reputation-read.module';
import { HealthModule } from './health/health.module';
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
    // Hardening KER-14: rate limiting por IP en todo el borde HTTP (guard global abajo).
    ThrottlerModule.forRoot(throttlerModuleOptions),
    CoreModule,
    AuthorizationModule,
    ReputationReadModule,
    MembershipModule,
    HiringModule,
    CareRecordModule,
    CareConsultModule,
    ReputationModule,
    ReferenceModule,
    HealthModule,
    OpsModule,
    WorkerModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Observabilidad KER-15: request-id + log JSON por request en todo el borde HTTP.
  // Como middleware corre antes que los guards: hasta un 401/429 sale correlacionado.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestLoggerMiddleware).forRoutes('{*splat}');
  }
}
