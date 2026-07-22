import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ResourceAccess, LinkRole, AccountRole } from '@keru/core';
import { EmergencyContact, Patient } from './entities/patient.entity';
import { PatientLink } from './entities/patient-link.entity';
import { Account } from './entities/account.entity';
import { FamilyInvitation, InvitationStatus } from './entities/family-invitation.entity';

export interface CreateInvitationInput {
  token: string;
  patientId: string;
  invitedByAccountId: string;
  invitedEmail: string;
  roleToGrant: LinkRole;
  expiresAt: Date;
}

export interface CreateAccountInput {
  email: string;
  passwordHash: string;
  role: AccountRole;
  displayName: string;
}

export interface CreatePatientInput {
  fullName: string;
  birthDate: string;
  photoUrl?: string | null;
  mainCondition: string;
  bloodGroup?: string | null;
  allergies: string[];
  emergencyContact: EmergencyContact;
}

/**
 * AccountAccess (constitution §3.1). Verbos atómicos sobre cuentas, identidades/perfiles de
 * paciente, vínculos familiares y roles, invitaciones, consentimiento y sesiones.
 * Única capa que toca el store. Verbos mutantes idempotentes por operationId (NFR-34).
 */
@ResourceAccess()
@Injectable()
export class AccountAccess {
  constructor(
    @InjectRepository(Patient) private readonly patients: Repository<Patient>,
    @InjectRepository(PatientLink) private readonly links: Repository<PatientLink>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(FamilyInvitation) private readonly invitations: Repository<FamilyInvitation>,
  ) {}

  // --- Invitaciones familiares (UC-03) ---

  createInvitation(input: CreateInvitationInput): Promise<FamilyInvitation> {
    return this.invitations.save(this.invitations.create({ ...input, status: 'pending' }));
  }

  findInvitationByToken(token: string): Promise<FamilyInvitation | null> {
    return this.invitations.findOne({ where: { token } });
  }

  async setInvitationStatus(
    id: string,
    status: InvitationStatus,
    confirmedByAccountId: string | null,
    confirmedAt: Date | null,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(FamilyInvitation) : this.invitations;
    await repo.update(id, { status, confirmedByAccountId, confirmedAt });
  }

  /** Vínculo (cuenta↔paciente) si existe. */
  getLink(patientId: string, accountId: string): Promise<PatientLink | null> {
    return this.links.findOne({ where: { patientId, accountId } });
  }

  /** Todos los vínculos de un paciente (para notificar al círculo, UC-18). */
  listLinksForPatient(patientId: string): Promise<PatientLink[]> {
    return this.links.find({ where: { patientId } });
  }

  // --- Cuentas (UC-04) ---

  /** Crea una cuenta. El email es único: lanza si ya existe (el Manager lo mapea a 409). */
  createAccount(input: CreateAccountInput): Promise<Account> {
    return this.accounts.save(this.accounts.create(input));
  }

  findAccountByEmail(email: string): Promise<Account | null> {
    return this.accounts.findOne({ where: { email } });
  }

  findAccountById(id: string): Promise<Account | null> {
    return this.accounts.findOne({ where: { id } });
  }

  /** Crea el perfil de paciente. Idempotente: un reintento con el mismo operationId devuelve el existente (NFR-34). */
  async createPatientProfile(
    input: CreatePatientInput,
    operationId: string,
    manager?: EntityManager,
  ): Promise<Patient> {
    const repo = manager ? manager.getRepository(Patient) : this.patients;

    const existing = await repo.findOne({ where: { createdByOperationId: operationId } });
    if (existing) return existing;

    const patient = repo.create({
      fullName: input.fullName,
      birthDate: input.birthDate,
      photoUrl: input.photoUrl ?? null,
      mainCondition: input.mainCondition,
      bloodGroup: input.bloodGroup ?? null,
      allergies: input.allergies ?? [],
      emergencyContact: input.emergencyContact,
      createdByOperationId: operationId,
    });
    return repo.save(patient);
  }

  /** Vincula una cuenta a un paciente con un rol. Idempotente: no duplica un vínculo existente. */
  async linkAccountToPatient(
    patientId: string,
    accountId: string,
    role: LinkRole,
    manager?: EntityManager,
  ): Promise<PatientLink> {
    const repo = manager ? manager.getRepository(PatientLink) : this.links;

    const existing = await repo.findOne({ where: { patientId, accountId } });
    if (existing) return existing;

    return repo.save(repo.create({ patientId, accountId, role }));
  }

  findPatientById(id: string): Promise<Patient | null> {
    return this.patients.findOne({ where: { id } });
  }

  /** Busca un candidato duplicado del mismo humano (nombre + fecha de nacimiento). Residuo #21. */
  findDuplicateCandidate(fullName: string, birthDate: string): Promise<Patient | null> {
    return this.patients.findOne({ where: { fullName, birthDate } });
  }

  /** Perfiles administrados por una cuenta (UC-22). */
  async listPatientsForAccount(accountId: string): Promise<Patient[]> {
    const links = await this.links.find({ where: { accountId } });
    if (links.length === 0) return [];
    return this.patients.find({ where: { id: In(links.map((l) => l.patientId)) } });
  }
}
