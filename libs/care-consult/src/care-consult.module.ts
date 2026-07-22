import { Module } from '@nestjs/common';
import { CareRecordModule } from '@keru/care-record';
import { CareConsultManager } from './manager/care-consult.manager';
import { CareConsultController } from './care-consult.controller';

/**
 * Dominio CareConsult (constitution §3). Camino de lectura clínica: estado, historial, gráficos.
 * UC-14/15. En el MVP lee el store clínico directo vía CareRecordAccess (proyección async diferida).
 * La autorización la resuelve el PermissionEngine (global, AuthorizationModule).
 */
@Module({
  imports: [CareRecordModule],
  controllers: [CareConsultController],
  providers: [CareConsultManager],
})
export class CareConsultModule {}
