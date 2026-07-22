import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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
}
