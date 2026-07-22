import { IsEmail, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LinkRole } from '@keru/core';
import { FamilyInvitation } from '../../resource-access/entities/family-invitation.entity';

const INVITABLE_ROLES: LinkRole[] = ['manager', 'viewer'];

/** UC-03 · Emitir invitación de vínculo familiar. */
export class CreateInvitationDto {
  @ApiProperty({ example: 'hermana@test.com', description: 'Invitado nombrado (se desafía su identidad al confirmar).' })
  @IsEmail()
  invitedEmail!: string;

  @ApiPropertyOptional({ enum: INVITABLE_ROLES, default: 'viewer' })
  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: LinkRole;
}

/** Respuesta de una invitación emitida. */
export class InvitationResponseDto {
  @ApiProperty()
  token!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty()
  invitedEmail!: string;

  @ApiProperty({ enum: ['pending', 'accepted', 'revoked'] })
  status!: string;

  @ApiProperty({ description: 'Vence a los 30 minutos de emitida (OQ-2).' })
  expiresAt!: Date;

  @ApiProperty({ description: 'Deep link para compartir (abre app o web).' })
  link!: string;

  static from(inv: FamilyInvitation): InvitationResponseDto {
    return {
      token: inv.token,
      patientId: inv.patientId,
      invitedEmail: inv.invitedEmail,
      status: inv.status,
      expiresAt: inv.expiresAt,
      link: `https://keru.app/invite/${inv.token}`,
    };
  }
}

/** UC-03 A4 · Invitación emitida, como se lista en la gestión del círculo. */
export class EmittedInvitationDto {
  @ApiProperty()
  token!: string;

  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty()
  invitedEmail!: string;

  @ApiProperty({ enum: ['consent-holder', 'manager', 'viewer'] })
  roleToGrant!: LinkRole;

  @ApiProperty({ enum: ['pending', 'accepted', 'revoked'] })
  status!: string;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'Cuenta que emitió la invitación (habilitada a revocarla).' })
  invitedByAccountId!: string;

  static from(inv: FamilyInvitation): EmittedInvitationDto {
    return {
      token: inv.token,
      patientId: inv.patientId,
      invitedEmail: inv.invitedEmail,
      roleToGrant: inv.roleToGrant,
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      invitedByAccountId: inv.invitedByAccountId,
    };
  }
}

/** Resultado de confirmar una invitación. */
export class InvitationConfirmedDto {
  @ApiProperty({ format: 'uuid' })
  patientId!: string;

  @ApiProperty({ enum: ['consent-holder', 'manager', 'viewer'] })
  role!: LinkRole;
}
