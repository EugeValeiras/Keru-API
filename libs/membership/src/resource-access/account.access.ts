import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ResourceAccess, LinkRole, AccountRole } from '@keru/core';
import { EmergencyContact, Patient } from './entities/patient.entity';
import { PatientLink } from './entities/patient-link.entity';
import { Account } from './entities/account.entity';
import { FamilyInvitation, InvitationStatus } from './entities/family-invitation.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';

export interface CreatePasswordResetTokenInput {
  token: string;
  accountId: string;
  expiresAt: Date;
}

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
  /** null cuando el alta es por invitación sin registro (UC-04 A5): la cuenta define su contraseña en el primer acceso. */
  passwordHash: string | null;
  role: AccountRole;
  displayName: string;
}

/** UC-23 · Campos editables del perfil de la cuenta (nunca email/role/password por esta vía). */
export interface UpdateAccountInput {
  displayName?: string;
  photoUrl?: string | null;
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
    @InjectRepository(PasswordResetToken)
    private readonly passwordResets: Repository<PasswordResetToken>,
  ) {}

  // --- Invitaciones familiares (UC-03) ---

  // operation-identity: exempt — UC-03: cada emisión crea deliberadamente un token
  // nuevo (30 min, un solo uso). Un retry de red puede acuñar dos tokens válidos:
  // riesgo bajo y acotado; decisión de agregar operationId → tarea KER-13.
  createInvitation(input: CreateInvitationInput): Promise<FamilyInvitation> {
    return this.invitations.save(this.invitations.create({ ...input, status: 'pending' }));
  }

  findInvitationByToken(token: string): Promise<FamilyInvitation | null> {
    return this.invitations.findOne({ where: { token } });
  }

  /** Invitaciones emitidas de un paciente, más recientes primero (UC-03 A4). */
  listInvitationsForPatient(patientId: string): Promise<FamilyInvitation[]> {
    return this.invitations.find({ where: { patientId }, order: { createdAt: 'DESC' } });
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

  // --- Recuperación de contraseña (UC-04 A4) ---

  // operation-identity: exempt — UC-04 A4: cada pedido de reset acuña deliberadamente un
  // token nuevo (corta vida, un solo uso), mismo criterio que createInvitation. El at-most-once
  // del reset lo garantiza el token de un solo uso al confirmar (precondición de estado), no
  // la emisión (que además es siempre 200 por anti-enumeración).
  createPasswordResetToken(input: CreatePasswordResetTokenInput): Promise<PasswordResetToken> {
    return this.passwordResets.save(this.passwordResets.create({ ...input, status: 'pending', usedAt: null }));
  }

  findPasswordResetByToken(token: string): Promise<PasswordResetToken | null> {
    return this.passwordResets.findOne({ where: { token } });
  }

  /** Marca el token consumido. Transición con precondición: naturalmente idempotente (NFR-34). */
  async markPasswordResetUsed(id: string, usedAt: Date, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(PasswordResetToken) : this.passwordResets;
    await repo.update(id, { status: 'used', usedAt });
  }

  /**
   * UC-04 A4 · Setea el hash de contraseña de la cuenta (reset de contraseña). Verbo dedicado
   * para no aflojar UpdateAccountInput, que nunca toca password. Naturalmente idempotente
   * (repetir el mismo hash deja el mismo estado): no requiere operationId (NFR-34, ADR-0002).
   */
  async updatePasswordHash(accountId: string, passwordHash: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(Account) : this.accounts;
    await repo.update(accountId, { passwordHash });
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
  // operation-identity: exempt — at-most-once garantizado por unique(email): el
  // retry tras un éxito con respuesta perdida da 409, nunca una cuenta duplicada.
  createAccount(input: CreateAccountInput, manager?: EntityManager): Promise<Account> {
    const repo = manager ? manager.getRepository(Account) : this.accounts;
    return repo.save(repo.create(input));
  }

  findAccountByEmail(email: string): Promise<Account | null> {
    return this.accounts.findOne({ where: { email } });
  }

  findAccountById(id: string): Promise<Account | null> {
    return this.accounts.findOne({ where: { id } });
  }

  /** Cuentas por id (para resolver los miembros del círculo, UC-22). */
  findAccountsByIds(ids: string[]): Promise<Account[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.accounts.find({ where: { id: In(ids) } });
  }

  /**
   * UC-23 · Set parcial del perfil de la cuenta (nombre/foto). Naturalmente idempotente
   * (repetir el mismo patch deja el mismo estado final), por eso no requiere operationId
   * (NFR-34, aclaración ADR-0002). Nunca toca email/role/password.
   */
  async updateAccount(accountId: string, patch: UpdateAccountInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(Account) : this.accounts;
    await repo.update(accountId, patch);
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

  /**
   * UC-22 · Set parcial de la ficha del paciente. Naturalmente idempotente (repetir el mismo
   * patch deja el mismo estado final), por eso no requiere operationId (NFR-34, aclaración).
   */
  async updatePatient(patientId: string, patch: Partial<CreatePatientInput>): Promise<void> {
    await this.patients.update(patientId, patch);
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
