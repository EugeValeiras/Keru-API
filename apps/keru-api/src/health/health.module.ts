import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Probe de salud de la API (KER-33). La HealthUtility la provee CoreModule (global). */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
