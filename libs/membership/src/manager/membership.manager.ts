import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  Manager,
  AuditUtility,
  EmailUtility,
  FileStorageUtility,
  LinkRole,
  TransactionUtility,
  JwtPayload,
  PubSubUtility,
  DomainEventType,
} from '@keru/core';
import { AccountAccess } from '../resource-access/account.access';
import { CaregiverAccess } from '../resource-access/caregiver.access';
import { Patient } from '../resource-access/entities/patient.entity';
import { Caregiver } from '../resource-access/entities/caregiver.entity';
import { FamilyInvitation } from '../resource-access/entities/family-invitation.entity';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RegisterCaregiverDto } from './dto/register-caregiver.dto';
import { AuthResponseDto, LoginDto, SignupDto } from './dto/auth.dto';

const INVITATION_TTL_MINUTES = 30; // OQ-2

export interface InvitationPreview {
  patientId: string;
  patientName: string;
  invitedEmail: string;
  expiresAt: Date;
  valid: boolean;
}

export interface RegisteredPatient {
  patient: Patient;
  age: number;
  duplicateCandidateId?: string;
}

/** UC-22 · Ficha del paciente + rol del vínculo de la cuenta que consulta. */
export interface PatientRecord {
  patient: Patient;
  age: number;
  linkRole: LinkRole;
}

/** UC-22 · Miembro del círculo del paciente: cuenta vinculada + rol de su vínculo. */
export interface CircleMember {
  accountId: string;
  displayName: string;
  email: string;
  role: LinkRole;
  since: Date;
}

/**
 * MembershipManager (constitution §3.1). Orquesta joining/leaving: registro, aprobación,
 * invitaciones, vínculos. Acá: UC-01 (registrar paciente) — crea el perfil y vincula al
 * creador como consent-holder, todo en una transacción y auditado.
 */
@Manager()
@Injectable()
export class MembershipManager {
  private readonly logger = new Logger(MembershipManager.name);

  private static readonly SALT_ROUNDS = 10;

  constructor(
    private readonly tx: TransactionUtility,
    private readonly accountAccess: AccountAccess,
    private readonly caregiverAccess: CaregiverAccess,
    private readonly jwt: JwtService,
    private readonly pubsub: PubSubUtility,
    private readonly audit: AuditUtility,
    private readonly email: EmailUtility,
    private readonly files: FileStorageUtility,
  ) {}

  // --- UC-04 · Autenticación ---

  async signup(dto: SignupDto): Promise<AuthResponseDto> {
    const existing = await this.accountAccess.findAccountByEmail(dto.email);
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    const passwordHash = await bcrypt.hash(dto.password, MembershipManager.SALT_ROUNDS);
    const account = await this.accountAccess.createAccount({
      email: dto.email,
      passwordHash,
      role: dto.role,
      displayName: dto.displayName,
    });
    await this.audit.record({
      action: 'membership.account.created',
      actor: account.id,
      target: { type: 'account', id: account.id },
      metadata: { role: account.role },
    });
    return this.issueToken(account.id, account.email, account.role, account.displayName);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const account = await this.accountAccess.findAccountByEmail(dto.email);
    if (!account) throw new UnauthorizedException('Credenciales inválidas');
    const ok = await bcrypt.compare(dto.password, account.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    return this.issueToken(account.id, account.email, account.role, account.displayName);
  }

  private async issueToken(
    accountId: string,
    email: string,
    role: JwtPayload['role'],
    displayName: string,
  ): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: accountId, email, role };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, accountId, email, role, displayName };
  }

  /** UC-01 · Registrar paciente. */
  async registerPatient(dto: RegisterPatientDto, actorAccountId: string): Promise<RegisteredPatient> {
    this.assertBirthDateNotFuture(dto.birthDate);

    // Residuo #21: candidato duplicado del mismo humano -> se informa, no se bloquea.
    const duplicate = await this.accountAccess.findDuplicateCandidate(dto.fullName, dto.birthDate);

    const patient = await this.tx.run(async (em) => {
      const created = await this.accountAccess.createPatientProfile(
        {
          fullName: dto.fullName,
          birthDate: dto.birthDate,
          photoUrl: dto.photoUrl ?? null,
          mainCondition: dto.mainCondition,
          bloodGroup: dto.bloodGroup ?? null,
          allergies: dto.allergies ?? [],
          emergencyContact: dto.emergencyContact,
        },
        dto.operationId,
        em,
      );

      // El creador queda vinculado como consent-holder (NFR-13).
      await this.accountAccess.linkAccountToPatient(created.id, actorAccountId, 'consent-holder', em);

      await this.audit.record({
        action: 'membership.patient.registered',
        actor: actorAccountId,
        target: { type: 'patient', id: created.id },
        metadata: { operationId: dto.operationId },
        manager: em,
      });

      return created;
    });

    return {
      patient,
      age: this.deriveAge(patient.birthDate),
      duplicateCandidateId:
        duplicate && duplicate.id !== patient.id ? duplicate.id : undefined,
    };
  }

  /** UC-22 · Perfiles administrados por la cuenta. */
  async listMyPatients(accountId: string): Promise<RegisteredPatient[]> {
    const patients = await this.accountAccess.listPatientsForAccount(accountId);
    return patients.map((p) => ({ patient: p, age: this.deriveAge(p.birthDate) }));
  }

  /** UC-22 · Ver la ficha del paciente. Cualquier rol de vínculo puede leer. */
  async getPatientRecord(patientId: string, accountId: string): Promise<PatientRecord> {
    const patient = await this.requirePatient(patientId);
    const link = await this.requireLink(patientId, accountId);
    return { patient, age: this.deriveAge(patient.birthDate), linkRole: link.role };
  }

  /** UC-22 · Círculo del paciente: cuentas vinculadas y su rol. Visible para cualquier vinculado. */
  async getPatientCircle(patientId: string, accountId: string): Promise<CircleMember[]> {
    await this.requirePatient(patientId);
    await this.requireLink(patientId, accountId);

    const links = await this.accountAccess.listLinksForPatient(patientId);
    const accounts = await this.accountAccess.findAccountsByIds(links.map((l) => l.accountId));
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    return links
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((link) => {
        const account = accountById.get(link.accountId);
        return {
          accountId: link.accountId,
          displayName: account?.displayName ?? '',
          email: account?.email ?? '',
          role: link.role,
          since: link.createdAt,
        };
      });
  }

  /** UC-22 · Editar la ficha. Solo `consent-holder` y `manager` (un `viewer` solo lee). */
  async updatePatient(
    patientId: string,
    dto: UpdatePatientDto,
    actorAccountId: string,
  ): Promise<PatientRecord> {
    await this.requirePatient(patientId);
    const link = await this.requireLink(patientId, actorAccountId);
    if (link.role !== 'consent-holder' && link.role !== 'manager') {
      throw new ForbiddenException('Solo quien gestiona al paciente puede editar la ficha');
    }
    if (dto.birthDate !== undefined) this.assertBirthDateNotFuture(dto.birthDate);

    // Set parcial: solo las claves presentes en el patch.
    const patch = Object.fromEntries(
      Object.entries({
        fullName: dto.fullName,
        birthDate: dto.birthDate,
        photoUrl: dto.photoUrl,
        mainCondition: dto.mainCondition,
        bloodGroup: dto.bloodGroup,
        allergies: dto.allergies,
        emergencyContact: dto.emergencyContact,
      }).filter(([, value]) => value !== undefined),
    );
    const fields = Object.keys(patch);

    if (fields.length > 0) {
      await this.accountAccess.updatePatient(patientId, patch);
      // Trazabilidad (constitution §2.3): quién, cuándo y qué campos.
      await this.audit.record({
        action: 'membership.patient.updated',
        actor: actorAccountId,
        target: { type: 'patient', id: patientId },
        metadata: { fields },
      });
    }

    const updated = await this.requirePatient(patientId);
    return { patient: updated, age: this.deriveAge(updated.birthDate), linkRole: link.role };
  }

  private async requirePatient(patientId: string): Promise<Patient> {
    const patient = await this.accountAccess.findPatientById(patientId);
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    return patient;
  }

  /** La cuenta debe tener vínculo con el paciente (constitution §2.4). */
  private async requireLink(patientId: string, accountId: string) {
    const link = await this.accountAccess.getLink(patientId, accountId);
    if (!link) throw new ForbiddenException('Sin acceso a este paciente');
    return link;
  }

  // --- UC-02 · Registrar cuidador ---

  /** La cuenta (rol caregiver) crea su perfil profesional, que nace en estado `pending`. */
  async registerCaregiver(dto: RegisterCaregiverDto, accountId: string): Promise<Caregiver> {
    const existing = await this.caregiverAccess.findByAccountId(accountId);
    if (existing) {
      throw new BadRequestException('La cuenta ya tiene un perfil de cuidador');
    }

    const caregiver = await this.caregiverAccess.createProfile(
      {
        accountId,
        displayName: dto.displayName,
        photoUrl: dto.photoUrl ?? null,
        specialties: dto.specialties,
        certifications: dto.certifications.map((c) => ({ ...c, verified: false })),
        availability: dto.availability,
        rates: { ratePerHour: dto.rates.ratePerHour, currency: dto.rates.currency ?? 'ARS', description: dto.rates.description },
        zone: dto.zone,
        modalities: dto.modalities,
      },
      dto.operationId,
    );

    await this.audit.record({
      action: 'membership.caregiver.registered',
      actor: accountId,
      target: { type: 'caregiver', id: caregiver.id },
      metadata: { status: caregiver.status },
    });
    return caregiver;
  }

  getMyCaregiverProfile(accountId: string): Promise<Caregiver | null> {
    return this.caregiverAccess.findByAccountId(accountId);
  }

  /**
   * UC-02 A2 · Re-postulación tras rechazo: corrige los datos y re-envía. El perfil vuelve a
   * `pending`, se limpia el motivo de rechazo y las certificaciones vuelven a "no verificada".
   * Solo desde el estado `rejected` (un perfil aprobado o desactivado no se re-envía por esta vía).
   */
  async resubmitCaregiver(dto: RegisterCaregiverDto, accountId: string): Promise<Caregiver> {
    const existing = await this.caregiverAccess.findByAccountId(accountId);
    if (!existing) throw new NotFoundException('No tenés un perfil de cuidador');
    if (existing.status !== 'rejected') {
      throw new BadRequestException('Solo un perfil rechazado puede re-enviarse');
    }

    await this.caregiverAccess.resubmitProfile(existing.id, {
      displayName: dto.displayName,
      photoUrl: dto.photoUrl ?? null,
      specialties: dto.specialties,
      certifications: dto.certifications.map((c) => ({ ...c, verified: false })),
      availability: dto.availability,
      rates: { ratePerHour: dto.rates.ratePerHour, currency: dto.rates.currency ?? 'ARS', description: dto.rates.description },
      zone: dto.zone,
      modalities: dto.modalities,
    });

    await this.audit.record({
      action: 'membership.caregiver.resubmitted',
      actor: accountId,
      target: { type: 'caregiver', id: existing.id },
    });

    return (await this.caregiverAccess.findByAccountId(accountId))!;
  }

  // --- UC-19 · Aprobar / verificar cuidador (back-office) ---

  listPendingCaregivers(): Promise<Caregiver[]> {
    return this.caregiverAccess.listByStatus('pending');
  }

  /** Detalle completo de un cuidador (back-office). */
  getCaregiverById(id: string): Promise<Caregiver> {
    return this.requireCaregiver(id);
  }

  /** Listado paginado con filtro por estado y búsqueda (back-office). */
  async listCaregivers(
    status: Caregiver['status'] | undefined,
    q: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ items: Caregiver[]; total: number; page: number; pageSize: number }> {
    const take = Math.min(Math.max(pageSize, 1), 100);
    const safePage = Math.max(page, 1);
    const [items, total] = await this.caregiverAccess.listPaged(status, q, (safePage - 1) * take, take);
    return { items, total, page: safePage, pageSize: take };
  }

  /** Métricas de cuidadores por estado (dashboard). */
  caregiverCountsByStatus(): Promise<Record<string, number>> {
    return this.caregiverAccess.countByStatus();
  }

  async approveCaregiver(caregiverId: string, adminId: string): Promise<Caregiver> {
    const caregiver = await this.requireCaregiver(caregiverId);
    await this.caregiverAccess.setStatus(caregiver.id, 'approved', adminId, null, new Date());
    await this.audit.record({
      action: 'membership.caregiver.approved',
      actor: adminId,
      target: { type: 'caregiver', id: caregiver.id },
    });
    return this.requireCaregiver(caregiverId);
  }

  async rejectCaregiver(caregiverId: string, adminId: string, reason: string): Promise<Caregiver> {
    const caregiver = await this.requireCaregiver(caregiverId);
    await this.caregiverAccess.setStatus(caregiver.id, 'rejected', adminId, reason, new Date());
    await this.audit.record({
      action: 'membership.caregiver.rejected',
      actor: adminId,
      target: { type: 'caregiver', id: caregiver.id },
      metadata: { reason },
    });
    return this.requireCaregiver(caregiverId);
  }

  async setCaregiverBadges(
    caregiverId: string,
    adminId: string,
    partial: Partial<Caregiver['badges']>,
  ): Promise<Caregiver> {
    const caregiver = await this.requireCaregiver(caregiverId);
    // Las 3 insignias son independientes: construimos el objeto completo para no perder ninguna clave.
    const badges = {
      certifications: partial.certifications ?? caregiver.badges?.certifications ?? false,
      identity: partial.identity ?? caregiver.badges?.identity ?? false,
      background: partial.background ?? caregiver.badges?.background ?? false,
    };
    await this.caregiverAccess.setBadges(caregiver.id, badges);
    await this.audit.record({
      action: 'membership.caregiver.badges-updated',
      actor: adminId,
      target: { type: 'caregiver', id: caregiver.id },
      metadata: { badges },
    });
    return this.requireCaregiver(caregiverId);
  }

  /** OQ-8/NFR-31 · Desactivar (ocultar) cuidador y disparar el ripple encolado a Hiring. */
  async deactivateCaregiver(caregiverId: string, adminId: string, reason?: string): Promise<Caregiver> {
    const caregiver = await this.requireCaregiver(caregiverId);
    if (caregiver.status === 'deactivated') {
      throw new BadRequestException('El cuidador ya está desactivado');
    }

    // Atómico: estado + evento outbox se escriben en la misma transacción (Decouple row 35).
    const event = await this.tx.run(async (em) => {
      await this.caregiverAccess.setStatus(caregiverId, 'deactivated', adminId, reason ?? null, new Date(), em);
      await this.audit.record({
        action: 'membership.caregiver.deactivated',
        actor: adminId,
        target: { type: 'caregiver', id: caregiverId },
        metadata: { reason },
        manager: em,
      });
      return this.pubsub.publish({
        manager: em,
        type: DomainEventType.CaregiverDeactivated,
        payload: { caregiverId },
      });
    });
    // Tras el commit, se encola para que el worker lo despache a HiringManager (Manager→Manager encolado).
    await this.pubsub.enqueue(event);

    return this.requireCaregiver(caregiverId);
  }

  /** Reactivar un cuidador desactivado (vuelve a estado aprobado y visible). */
  async reactivateCaregiver(caregiverId: string, adminId: string): Promise<Caregiver> {
    const caregiver = await this.requireCaregiver(caregiverId);
    if (caregiver.status !== 'deactivated') {
      throw new BadRequestException('Solo se puede reactivar un cuidador desactivado');
    }
    await this.caregiverAccess.setStatus(caregiverId, 'approved', adminId, null, new Date());
    await this.audit.record({
      action: 'membership.caregiver.reactivated',
      actor: adminId,
      target: { type: 'caregiver', id: caregiverId },
    });
    return this.requireCaregiver(caregiverId);
  }

  // --- Foto de perfil (UC-01/UC-02): sube la imagen y devuelve la URL para photoUrl ---
  async uploadImage(buffer: Buffer, mimeType: string): Promise<{ url: string }> {
    const { url } = await this.files.putImage(buffer, mimeType);
    return { url };
  }

  private async requireCaregiver(id: string): Promise<Caregiver> {
    const caregiver = await this.caregiverAccess.findById(id);
    if (!caregiver) throw new NotFoundException('Cuidador no encontrado');
    return caregiver;
  }

  // --- UC-03 · Invitación de vínculo familiar ---

  /** El paciente o un familiar ya vinculado emite una invitación (30 min, un solo uso). */
  async issueInvitation(
    patientId: string,
    inviterAccountId: string,
    invitedEmail: string,
    role: LinkRole,
  ): Promise<FamilyInvitation> {
    const patient = await this.accountAccess.findPatientById(patientId);
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    // Solo quien está vinculado al paciente puede invitar.
    const link = await this.accountAccess.getLink(patientId, inviterAccountId);
    if (!link) throw new ForbiddenException('No estás vinculado a este paciente');

    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MINUTES * 60_000);
    const invitation = await this.accountAccess.createInvitation({
      token,
      patientId,
      invitedByAccountId: inviterAccountId,
      invitedEmail: invitedEmail.toLowerCase(),
      roleToGrant: role,
      expiresAt,
    });

    await this.audit.record({
      action: 'membership.invitation.issued',
      actor: inviterAccountId,
      target: { type: 'patient', id: patientId },
      metadata: { invitedEmail, role, expiresAt },
    });

    // UC-03: el sistema envía el link por email al invitado. Mejor esfuerzo:
    // un fallo de SES no invalida la invitación (la UI ofrece copiar/compartir).
    void this.email
      .sendInvitationEmail({
        to: invitation.invitedEmail,
        patientName: patient.fullName,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      })
      .catch((err) =>
        this.logger.warn(`No se pudo enviar el email de invitación: ${(err as Error).message}`),
      );

    return invitation;
  }

  /** Datos para la pantalla de confirmación. No valida identidad (eso ocurre al confirmar). */
  async previewInvitation(token: string): Promise<InvitationPreview> {
    const inv = await this.accountAccess.findInvitationByToken(token);
    if (!inv) throw new NotFoundException('Invitación inválida');
    const patient = await this.accountAccess.findPatientById(inv.patientId);
    return {
      patientId: inv.patientId,
      patientName: patient?.fullName ?? '',
      invitedEmail: inv.invitedEmail,
      expiresAt: inv.expiresAt,
      valid: inv.status === 'pending' && inv.expiresAt.getTime() > Date.now(),
    };
  }

  /** Confirma la invitación: desafío de identidad (NFR-19), 30 min single-use (OQ-2), y crea el vínculo. */
  async confirmInvitation(
    token: string,
    accountId: string,
    accountEmail: string,
  ): Promise<{ patientId: string; role: LinkRole }> {
    const inv = await this.accountAccess.findInvitationByToken(token);
    if (!inv) throw new NotFoundException('Invitación inválida'); // A2

    if (inv.status !== 'pending') {
      throw new BadRequestException('La invitación ya fue usada o revocada'); // single-use
    }
    if (inv.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('La invitación expiró'); // A2 (30 min)
    }
    // Desafío de identidad: solo el invitado nombrado puede confirmar (NFR-19).
    if (inv.invitedEmail.toLowerCase() !== accountEmail.toLowerCase()) {
      throw new ForbiddenException('Esta invitación no corresponde a tu cuenta');
    }

    await this.tx.run(async (em) => {
      await this.accountAccess.linkAccountToPatient(inv.patientId, accountId, inv.roleToGrant, em);
      await this.accountAccess.setInvitationStatus(inv.id, 'accepted', accountId, new Date(), em);
      await this.audit.record({
        action: 'membership.invitation.confirmed',
        actor: accountId,
        target: { type: 'patient', id: inv.patientId },
        metadata: { role: inv.roleToGrant },
        manager: em,
      });
      // NFR-19: notificar el alta a todo el círculo. TODO(UC-18): vía NotificationAccess.
      await this.audit.record({
        action: 'membership.circle.joined',
        actor: accountId,
        target: { type: 'patient', id: inv.patientId },
        manager: em,
      });
    });

    return { patientId: inv.patientId, role: inv.roleToGrant };
  }

  private assertBirthDateNotFuture(birthDate: string): void {
    const dob = new Date(birthDate);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('birthDate inválida');
    }
    if (dob.getTime() > Date.now()) {
      throw new BadRequestException('birthDate no puede ser futura');
    }
  }

  /** La edad se deriva de la fecha de nacimiento (UC-01: nunca se guardan ambas inconsistentes). */
  private deriveAge(birthDate: string): number {
    const dob = new Date(birthDate);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }
}
