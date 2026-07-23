import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  Manager,
  AuditUtility,
  AuthPrincipal,
  EmailUtility,
  FileStorageUtility,
  LinkRole,
  TransactionUtility,
  TokenRevocationUtility,
  JwtPayload,
  PubSubUtility,
  DomainEventType,
} from '@keru/core';
import { AccountAccess, UpdateAccountInput } from '../resource-access/account.access';
import { CaregiverAccess, UpdateApprovedProfileInput } from '../resource-access/caregiver.access';
import { Account } from '../resource-access/entities/account.entity';
import { Patient } from '../resource-access/entities/patient.entity';
import { Caregiver } from '../resource-access/entities/caregiver.entity';
import { FamilyInvitation } from '../resource-access/entities/family-invitation.entity';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RegisterCaregiverDto } from './dto/register-caregiver.dto';
import { UpdateCaregiverProfileDto } from './dto/update-caregiver-profile.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import {
  AuthResponseDto,
  EmailVerificationConfirmDto,
  LoginDto,
  PasswordResetConfirmDto,
  SignupDto,
  StepUpResponseDto,
} from './dto/auth.dto';

const INVITATION_TTL_MINUTES = 30; // OQ-2
const PASSWORD_RESET_TTL_MINUTES = 30; // UC-04 A4: corta vida, patrón NFR-19
const EMAIL_VERIFICATION_TTL_MINUTES = 30; // UC-04 A5: corta vida, patrón NFR-19

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
    private readonly tokenRevocation: TokenRevocationUtility,
    private readonly config: ConfigService,
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
    // UC-04 A5: la cuenta arranca sin verificar (createAccount → DB default false); disparamos
    // el email de verificación (mejor esfuerzo). No invalidamos nada: es el primer token.
    await this.issueEmailVerification(account, false);
    return this.issueToken(account);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const account = await this.accountAccess.findAccountByEmail(dto.email);
    if (!account) throw new UnauthorizedException('Credenciales inválidas');
    const ok = await bcrypt.compare(dto.password, account.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    return this.issueToken(account);
  }

  private async issueToken(account: Account): Promise<AuthResponseDto> {
    // jti (NFR-41, KER-38): identidad del token — sin ella no hay revocación server-side.
    const payload: JwtPayload = {
      sub: account.id,
      email: account.email,
      role: account.role,
      jti: randomUUID(),
    };
    const accessToken = await this.jwt.signAsync(payload);
    // photoUrl (UC-23): viaja en la respuesta de auth para que el header pinte el avatar real
    // ni bien inicia sesión (y tras recargar, desde la sesión persistida) sin una llamada extra.
    return {
      accessToken,
      accountId: account.id,
      email: account.email,
      role: account.role,
      displayName: account.displayName,
      photoUrl: account.photoUrl,
      emailVerified: account.emailVerified,
    };
  }

  /**
   * UC-04 · Logout server-side (KER-38, NFR-41): deslista el jti hasta la expiración natural
   * del token y revoca las push subscriptions de la sesión — la del device si el cliente la
   * identifica, todas las de la cuenta si no (la higiene le gana a la comodidad). Las push
   * viven en CareRecord (dueño único): viajan por outbox (Manager→Manager solo encolado).
   */
  async logout(principal: AuthPrincipal, pushEndpoint?: string): Promise<void> {
    if (principal.jti) await this.tokenRevocation.revoke(principal.jti, principal.tokenExp);

    const event = await this.tx.run(async (em) => {
      await this.audit.record({
        action: 'membership.session.logout',
        actor: principal.accountId,
        target: { type: 'account', id: principal.accountId },
        metadata: { jti: principal.jti ?? null, pushEndpoint: pushEndpoint ?? null },
        manager: em,
      });
      return this.pubsub.publish({
        manager: em,
        type: DomainEventType.SessionRevoked,
        payload: { accountId: principal.accountId, pushEndpoint: pushEndpoint ?? null },
      });
    });
    await this.pubsub.enqueue(event);
  }

  /**
   * UC-04 A3 · Step-up (KER-38, NFR-33): re-confirmación de password que emite un token corto
   * (claim `step_up`) exigido por StepUpGuard en las operaciones sensibles. Emisión auditada;
   * cada uso lo audita el guard.
   */
  async stepUp(principal: AuthPrincipal, password: string): Promise<StepUpResponseDto> {
    const account = await this.accountAccess.findAccountById(principal.accountId);
    if (!account) throw new UnauthorizedException('Credenciales inválidas');
    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');

    const expiresInSeconds = Number(this.config.get<string>('JWT_STEP_UP_TTL_SECONDS', '300'));
    const jti = randomUUID();
    const payload: JwtPayload = { sub: account.id, email: account.email, role: account.role, jti, step_up: true };
    const stepUpToken = await this.jwt.signAsync(payload, { expiresIn: expiresInSeconds });
    await this.audit.record({
      action: 'auth.step-up.issued',
      actor: account.id,
      target: { type: 'account', id: account.id },
      metadata: { jti, expiresInSeconds },
    });
    return { stepUpToken, expiresInSeconds };
  }

  /**
   * UC-04 A4 · Pedido de recuperación de contraseña. Responde SIEMPRE ok (anti-enumeración): el
   * llamador nunca sabe si el email existe. Si la cuenta existe, acuña un token de un solo uso y
   * corta vida (patrón NFR-19), lo audita y envía el link por email (mejor esfuerzo: un fallo de
   * SES no rompe el flujo — el usuario puede volver a pedirlo).
   */
  async requestPasswordReset(email: string): Promise<void> {
    const account = await this.accountAccess.findAccountByEmail(email);
    // Anti-enumeración: sin cuenta, no hacemos nada pero devolvemos igual (200 arriba).
    if (!account) return;

    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000);
    const reset = await this.accountAccess.createPasswordResetToken({
      token,
      accountId: account.id,
      expiresAt,
    });

    await this.audit.record({
      action: 'auth.password-reset.issued',
      actor: account.id,
      target: { type: 'account', id: account.id },
      metadata: { resetId: reset.id, expiresAt },
    });

    void this.email
      .sendPasswordResetEmail({ to: account.email, token: reset.token, expiresAt: reset.expiresAt })
      .catch((err) =>
        this.logger.warn(`No se pudo enviar el email de recuperación: ${(err as Error).message}`),
      );
  }

  /**
   * UC-04 A4 · Confirmación del reset. Valida el token (existe, pendiente, no expirado; si no →
   * 410 sin revelar cuál de las tres). Con token válido: setea el hash nuevo, marca el token
   * usado y audita el uso, todo en una transacción; luego REVOCA todas las sesiones vigentes de
   * la cuenta (corte por cuenta en la denylist + limpieza de push subscriptions vía outbox). El
   * at-most-once (NFR-34) lo garantiza el token de un solo uso, no un operationId aparte
   * (ADR-0002). Devuelve una sesión nueva (auto-login) para que el usuario siga sin re-loguear.
   */
  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<AuthResponseDto> {
    const reset = await this.accountAccess.findPasswordResetByToken(dto.token);
    // Anti-enumeración: no distinguimos inexistente / usado / expirado (todo 410).
    if (!reset || reset.status !== 'pending' || reset.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('El enlace de recuperación es inválido o expiró');
    }

    const account = await this.accountAccess.findAccountById(reset.accountId);
    if (!account) throw new GoneException('El enlace de recuperación es inválido o expiró');

    const passwordHash = await bcrypt.hash(dto.newPassword, MembershipManager.SALT_ROUNDS);
    const event = await this.tx.run(async (em) => {
      await this.accountAccess.updatePasswordHash(account.id, passwordHash, em);
      await this.accountAccess.markPasswordResetUsed(reset.id, new Date(), em);
      await this.audit.record({
        action: 'auth.password-reset.used',
        actor: account.id,
        target: { type: 'account', id: account.id },
        metadata: { resetId: reset.id },
        manager: em,
      });
      // NFR-41: expulsar las sesiones vigentes de la cuenta también limpia sus push subscriptions
      // (viven en CareRecord, dueño único): Manager→Manager solo encolado. Sin endpoint → toda la cuenta.
      return this.pubsub.publish({
        manager: em,
        type: DomainEventType.SessionRevoked,
        payload: { accountId: account.id, pushEndpoint: null },
      });
    });

    // Corte por cuenta en la denylist: todo token emitido antes de ahora recibe 401 (NFR-41).
    await this.tokenRevocation.revokeAccountSessions(account.id);
    await this.pubsub.enqueue(event);

    // Auto-login: el token nuevo es posterior al corte, así que sobrevive a la revocación.
    return this.issueToken(account);
  }

  // --- UC-04 A5 · Verificación de email del self-signup ---

  /**
   * Acuña y envía un token de verificación (un solo uso, corta vida) para la cuenta. Al reenviar
   * (`invalidatePrevious=true`) invalida primero los pendientes anteriores: solo el último link
   * sirve. Emisión auditada; envío de email mejor esfuerzo (un fallo de SES no rompe el flujo).
   */
  private async issueEmailVerification(account: Account, invalidatePrevious: boolean): Promise<void> {
    if (invalidatePrevious) {
      await this.accountAccess.invalidatePendingEmailVerifications(account.id, new Date());
    }
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MINUTES * 60_000);
    const verification = await this.accountAccess.createEmailVerificationToken({
      token,
      accountId: account.id,
      expiresAt,
    });

    await this.audit.record({
      action: 'auth.email-verification.issued',
      actor: account.id,
      target: { type: 'account', id: account.id },
      metadata: { verificationId: verification.id, expiresAt },
    });

    void this.email
      .sendEmailVerificationEmail({ to: account.email, token: verification.token, expiresAt: verification.expiresAt })
      .catch((err) =>
        this.logger.warn(`No se pudo enviar el email de verificación: ${(err as Error).message}`),
      );
  }

  /**
   * UC-04 A5 · Pedir/reenviar el email de verificación. Responde SIEMPRE ok (anti-enumeración): el
   * llamador nunca sabe si el email existe. Si la cuenta existe y NO está verificada, acuña un token
   * nuevo, invalida los pendientes anteriores y reenvía el email. Si ya está verificada, no hace nada.
   */
  async requestEmailVerification(email: string): Promise<void> {
    const account = await this.accountAccess.findAccountByEmail(email);
    // Anti-enumeración: sin cuenta (o ya verificada), no hacemos nada pero devolvemos igual (200 arriba).
    if (!account || account.emailVerified) return;
    await this.issueEmailVerification(account, true);
  }

  /**
   * UC-04 A5 · Confirmación de la verificación. Valida el token (existe, pendiente, no expirado; si
   * no → 410 sin distinguir cuál de las tres). Con token válido: marca la cuenta verificada, consume
   * el token y audita el uso, todo en una transacción. El at-most-once (NFR-34) lo garantiza el token
   * de un solo uso, no un operationId aparte (ADR-0002). Devuelve una sesión nueva (auto-login) ya con
   * `emailVerified=true`, para que el banner del cliente desaparezca sin re-loguear.
   */
  async confirmEmailVerification(dto: EmailVerificationConfirmDto): Promise<AuthResponseDto> {
    const verification = await this.accountAccess.findEmailVerificationByToken(dto.token);
    // Anti-enumeración: no distinguimos inexistente / usado / expirado (todo 410).
    if (!verification || verification.status !== 'pending' || verification.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('El enlace de verificación es inválido o expiró');
    }

    const account = await this.accountAccess.findAccountById(verification.accountId);
    if (!account) throw new GoneException('El enlace de verificación es inválido o expiró');

    await this.tx.run(async (em) => {
      await this.accountAccess.markEmailVerified(account.id, em);
      await this.accountAccess.markEmailVerificationUsed(verification.id, new Date(), em);
      await this.audit.record({
        action: 'auth.email-verification.confirmed',
        actor: account.id,
        target: { type: 'account', id: account.id },
        metadata: { verificationId: verification.id },
        manager: em,
      });
    });

    // Auto-login con el estado ya verificado (el objeto en memoria trae emailVerified=false).
    return this.issueToken({ ...account, emailVerified: true });
  }

  // --- UC-23 · Perfil de la cuenta ---

  /** UC-23 · Datos propios de la cuenta autenticada (nombre, email, rol, foto). */
  async getMyAccount(accountId: string): Promise<Account> {
    const account = await this.accountAccess.findAccountById(accountId);
    if (!account) throw new NotFoundException('No se encontró la cuenta');
    return account;
  }

  /**
   * UC-23 · Editar el perfil de la cuenta: set parcial de nombre y/o foto (nunca email/role).
   * Naturalmente idempotente (NFR-34, ADR-0002): no lleva operationId. Auditado. Si el patch
   * viene vacío devuelve la cuenta sin tocar la base.
   */
  async updateMyAccount(dto: UpdateAccountDto, accountId: string): Promise<Account> {
    const account = await this.accountAccess.findAccountById(accountId);
    if (!account) throw new NotFoundException('No se encontró la cuenta');

    // Set parcial: solo las claves presentes en el patch.
    const patch: UpdateAccountInput = Object.fromEntries(
      Object.entries({ displayName: dto.displayName, photoUrl: dto.photoUrl }).filter(
        ([, value]) => value !== undefined,
      ),
    );
    const fields = Object.keys(patch);
    if (fields.length === 0) return account;

    await this.tx.run(async (em) => {
      await this.accountAccess.updateAccount(accountId, patch, em);
      await this.audit.record({
        action: 'membership.account.profile-updated',
        actor: accountId,
        target: { type: 'account', id: accountId },
        metadata: { fields },
        manager: em,
      });
    });

    return (await this.accountAccess.findAccountById(accountId))!;
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

  /**
   * UC-02 A3 · Edición del perfil aprobado: foto, disponibilidad, tarifas, zona y modalidades,
   * sin re-aprobación (el perfil sigue `approved` y visible). La tarifa es efectivo-fechada
   * (NFR-03/23): cada cambio agrega una versión al historial (append-only) y actualiza la
   * vigente que lee el marketplace; las solicitudes existentes conservan su snapshot pinneado.
   * Credenciales (nombre/especialidades/certificaciones) no se tocan por esta vía (constitution §7).
   */
  async updateApprovedCaregiver(dto: UpdateCaregiverProfileDto, accountId: string): Promise<Caregiver> {
    const existing = await this.caregiverAccess.findByAccountId(accountId);
    if (!existing) throw new NotFoundException('No tenés un perfil de cuidador');
    if (existing.status !== 'approved') {
      throw new BadRequestException(
        'Solo un perfil aprobado se edita por esta vía (pendiente espera revisión; rechazado usa la re-postulación)',
      );
    }

    // Set parcial: solo las claves presentes en el patch (nunca credenciales ni status).
    const patch: UpdateApprovedProfileInput = Object.fromEntries(
      Object.entries({
        photoUrl: dto.photoUrl,
        availability: dto.availability,
        zone: dto.zone,
        modalities: dto.modalities,
      }).filter(([, value]) => value !== undefined),
    );
    const newRates = dto.rates
      ? {
          ratePerHour: dto.rates.ratePerHour,
          currency: dto.rates.currency ?? existing.rates?.currency ?? 'ARS',
          description: dto.rates.description,
        }
      : undefined;

    const fields = [...Object.keys(patch), ...(newRates ? ['rates'] : [])];
    if (fields.length === 0) return existing;

    await this.tx.run(async (em) => {
      if (newRates) {
        // NFR-03/23: la historia no se reescribe — se agrega la versión vigente-desde-ahora
        // y se actualiza la tarifa vigente que lee el marketplace, en la misma transacción.
        await this.caregiverAccess.createRateVersion(existing.id, newRates, new Date(), dto.operationId, em);
        patch.rates = newRates;
      }
      await this.caregiverAccess.updateApprovedProfile(existing.id, patch, em);
      await this.audit.record({
        action: 'membership.caregiver.profile-updated',
        actor: accountId,
        target: { type: 'caregiver', id: existing.id },
        metadata: { fields },
        manager: em,
      });
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

    // UC-04 A5 · Gate del self-signup no-verificado: emitir una invitación da acceso al círculo
    // clínico de un paciente y manda email a un tercero — la acción más sensible que un self-signup
    // alcanza por su cuenta. Sin email verificado → 403 EMAIL_NOT_VERIFIED (código propio para que el
    // cliente ofrezca verificar, no que interprete falta de permiso/rol).
    const inviter = await this.accountAccess.findAccountById(inviterAccountId);
    if (!inviter?.emailVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Verificá tu email para poder invitar a otras personas',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

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

  /** UC-03 A4 · Invitaciones emitidas del paciente. Cualquier vinculado puede verlas. */
  async listInvitations(patientId: string, accountId: string): Promise<FamilyInvitation[]> {
    await this.requirePatient(patientId);
    await this.requireLink(patientId, accountId);
    return this.accountAccess.listInvitationsForPatient(patientId);
  }

  /**
   * UC-03 A5 · Revocar una invitación pendiente. Solo el emisor o un `consent-holder` del
   * paciente. Una aceptada no se revoca (el vínculo se gestiona desde el círculo); re-revocar
   * una revocada es un no-op (transición con precondición: naturalmente idempotente, NFR-34).
   */
  async revokeInvitation(token: string, accountId: string): Promise<FamilyInvitation> {
    const inv = await this.accountAccess.findInvitationByToken(token);
    if (!inv) throw new NotFoundException('Invitación inválida');

    const link = await this.accountAccess.getLink(inv.patientId, accountId);
    const isIssuer = inv.invitedByAccountId === accountId;
    if (!isIssuer && link?.role !== 'consent-holder') {
      throw new ForbiddenException('Solo quien emitió la invitación o el titular puede revocarla');
    }

    if (inv.status === 'revoked') return inv;
    if (inv.status === 'accepted') {
      throw new BadRequestException('La invitación ya fue aceptada: no se puede revocar');
    }

    await this.accountAccess.setInvitationStatus(inv.id, 'revoked', null, null);
    await this.audit.record({
      action: 'membership.invitation.revoked',
      actor: accountId,
      target: { type: 'patient', id: inv.patientId },
      metadata: { invitationId: inv.id, invitedEmail: inv.invitedEmail },
    });

    return { ...inv, status: 'revoked' };
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
