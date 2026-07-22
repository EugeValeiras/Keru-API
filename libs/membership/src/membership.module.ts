import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Patient } from './resource-access/entities/patient.entity';
import { PatientLink } from './resource-access/entities/patient-link.entity';
import { Account } from './resource-access/entities/account.entity';
import { Caregiver } from './resource-access/entities/caregiver.entity';
import { FamilyInvitation } from './resource-access/entities/family-invitation.entity';
import { AccountAccess } from './resource-access/account.access';
import { CaregiverAccess } from './resource-access/caregiver.access';
import { MembershipManager } from './manager/membership.manager';
import { MembershipController } from './membership.controller';
import { AuthController } from './auth.controller';
import { CaregiverController } from './caregiver.controller';
import { AdminCaregiverController } from './admin-caregiver.controller';
import { InvitationController } from './invitation.controller';

/**
 * Dominio Membership (constitution §3). Alta, login, vínculos, aprobación de cuidadores.
 * UC-01..04, UC-19, UC-22. Dueño único de escritura de cuentas/vínculos/roles/perfiles de cuidador.
 *
 * Implementado: UC-04 (auth), UC-01/22 (pacientes), UC-02 (registrar cuidador), UC-19 (aprobación).
 * TODO: UC-03 (invitación familiar).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Patient, PatientLink, Account, Caregiver, FamilyInvitation])],
  controllers: [
    AuthController,
    MembershipController,
    CaregiverController,
    AdminCaregiverController,
    InvitationController,
  ],
  providers: [AccountAccess, CaregiverAccess, MembershipManager],
  exports: [AccountAccess, CaregiverAccess, MembershipManager],
})
export class MembershipModule {}
