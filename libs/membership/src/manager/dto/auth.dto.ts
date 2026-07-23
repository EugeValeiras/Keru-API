import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountRole } from '@keru/core';

const SIGNUP_ROLES: AccountRole[] = ['patient', 'family', 'caregiver'];

/** UC-04 · Alta de cuenta. El rol admin no se auto-registra. */
export class SignupDto {
  @ApiProperty({ example: 'familiar@test.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'S3gura!123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ enum: SIGNUP_ROLES, example: 'family' })
  @IsIn(SIGNUP_ROLES)
  role!: AccountRole;

  @ApiProperty({ example: 'Juan Díaz' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;
}

/** UC-04 · Login. */
export class LoginDto {
  @ApiProperty({ example: 'familiar@test.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'S3gura!123' })
  @IsString()
  @MinLength(1)
  password!: string;
}

/** UC-04 · Logout server-side (KER-38, NFR-41). */
export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Endpoint Web Push del device que cierra sesión: se revoca esa suscripción. Sin él, se revocan todas las de la cuenta.',
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  pushEndpoint?: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

/** UC-04 A3 · Re-confirmación de identidad para operaciones sensibles (KER-38, NFR-33). */
export class StepUpDto {
  @ApiProperty({ example: 'S3gura!123', description: 'Password de la cuenta de la sesión' })
  @IsString()
  @MinLength(1)
  password!: string;
}

/** UC-04 A4 · Pedido de recuperación de contraseña. Responde SIEMPRE 200 (anti-enumeración). */
export class PasswordResetRequestDto {
  @ApiProperty({ example: 'familiar@test.com' })
  @IsEmail()
  email!: string;
}

export class PasswordResetRequestResponseDto {
  @ApiProperty({
    example: true,
    description: 'Siempre true: no revela si el email existe (anti-enumeración, UC-04 A4).',
  })
  ok!: boolean;
}

/** UC-04 A4 · Confirmación: token del email + nueva contraseña (misma fuerza que el alta). */
export class PasswordResetConfirmDto {
  @ApiProperty({ description: 'Token de un solo uso recibido por email' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ example: 'S3gura!123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

/** UC-04 A5 · Pedir/reenviar el email de verificación. Responde SIEMPRE 200 (anti-enumeración). */
export class EmailVerificationRequestDto {
  @ApiProperty({ example: 'familiar@test.com' })
  @IsEmail()
  email!: string;
}

export class EmailVerificationRequestResponseDto {
  @ApiProperty({
    example: true,
    description: 'Siempre true: no revela si el email existe ni si ya está verificado (anti-enumeración, UC-04 A5).',
  })
  ok!: boolean;
}

/** UC-04 A5 · Confirmación de verificación: token de un solo uso recibido por email. */
export class EmailVerificationConfirmDto {
  @ApiProperty({ description: 'Token de un solo uso recibido por email' })
  @IsString()
  @MinLength(1)
  token!: string;
}

export class StepUpResponseDto {
  @ApiProperty({ description: 'Token corto con claim step_up: acompaña la operación sensible en x-step-up-token' })
  stepUpToken!: string;

  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;
}

/** Respuesta de auth: token + datos básicos de la cuenta. */
export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ format: 'uuid' })
  accountId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['patient', 'family', 'caregiver', 'admin'] })
  role!: AccountRole;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'UC-23 · Foto de la cuenta para el avatar del header (null si no cargó una)' })
  photoUrl?: string | null;

  @ApiProperty({
    example: false,
    description:
      'UC-04 A5 · Si el email de la cuenta está verificado. El self-signup arranca en false; el cliente muestra el banner y gatea acciones sensibles hasta que confirme.',
  })
  emailVerified!: boolean;
}
