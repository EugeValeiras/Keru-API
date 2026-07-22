import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MembershipModule } from '@keru/membership';
import { ClinicalRecord } from './resource-access/entities/clinical-record.entity';
import { Alert } from './resource-access/entities/alert.entity';
import { Notification } from './resource-access/entities/notification.entity';
import { QuarantinedRecord } from './resource-access/entities/quarantined-record.entity';
import { CareRecordAccess } from './resource-access/care-record.access';
import { RangeAccess } from './resource-access/range.access';
import { AlertAccess } from './resource-access/alert.access';
import { QuarantineAccess } from './resource-access/quarantine.access';
import { AlertEngine } from './engine/alert.engine';
import { CareRecordManager } from './manager/care-record.manager';
import { CareRecordController } from './care-record.controller';
import { NotificationController } from './notification.controller';
import { QuarantineController } from './quarantine.controller';

/**
 * Dominio CareRecord ⭐ (constitution §3, unidad clínica protegida). Capturar → evaluar → persistir
 * → notificar + centro de alertas. UC-12/13/18/20. Dueño de escritura: registros clínicos y alertas.
 * Lee cuidadores/vínculos (Membership) y asignaciones (Hiring) para el permiso al momento de medición.
 */
@Module({
  imports: [MembershipModule, TypeOrmModule.forFeature([ClinicalRecord, Alert, Notification, QuarantinedRecord])],
  controllers: [CareRecordController, NotificationController, QuarantineController],
  providers: [CareRecordAccess, RangeAccess, AlertAccess, QuarantineAccess, AlertEngine, CareRecordManager],
  exports: [CareRecordAccess],
})
export class CareRecordModule {}
