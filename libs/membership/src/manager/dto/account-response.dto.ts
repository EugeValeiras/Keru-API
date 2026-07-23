import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountRole } from '@keru/core';
import { Account } from '../../resource-access/entities/account.entity';

/**
 * UC-23 · Perfil propio de la cuenta autenticada (GET /accounts/me). Los datos que el titular
 * ve de sí mismo: identidad de login (email/role, no editables) + lo editable (nombre, foto).
 */
export class AccountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Identidad de login: de solo lectura (no se edita por esta vía)' })
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  photoUrl?: string | null;

  @ApiProperty({ enum: ['patient', 'family', 'caregiver', 'admin'] })
  role!: AccountRole;

  static from(a: Account): AccountResponseDto {
    return {
      id: a.id,
      email: a.email,
      displayName: a.displayName,
      photoUrl: a.photoUrl,
      role: a.role,
    };
  }
}
