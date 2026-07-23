import { Module } from '@nestjs/common';
import { MembershipModule } from '@keru/membership';
import { HiringModule } from '@keru/hiring';
import { ReputationModule } from '@keru/reputation';
import { SchedulerService } from './scheduler.service';
import { OpsController } from './ops.controller';
import { AuditController } from './audit.controller';
import { DashboardController } from './dashboard.controller';
import { OutboxOpsController } from './outbox.controller';

/** Ops: barrido de vencidos, auditoría, dashboard y DLQ del outbox (KER-33). NFR-14/33/55. */
@Module({
  imports: [MembershipModule, HiringModule, ReputationModule],
  providers: [SchedulerService],
  controllers: [OpsController, AuditController, DashboardController, OutboxOpsController],
})
export class OpsModule {}
