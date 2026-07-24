import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LinkRole } from '@keru/core';

/** Los tres roles del círculo son destinos válidos de una re-asignación (incluye consent-holder, para transferir la titularidad — UC-22 A3). */
const ASSIGNABLE_ROLES: LinkRole[] = ['consent-holder', 'manager', 'viewer'];

/**
 * UC-22 A3 · Cambiar el rol de un vínculo ya existente del círculo. A diferencia de una
 * invitación (que solo otorga manager/viewer), acá `consent-holder` sí es un destino válido:
 * es la vía para transferir/compartir la titularidad antes de degradar al titular previo (A4).
 */
export class ChangeLinkRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLES, description: 'Nuevo rol del vínculo con el paciente.' })
  @IsIn(ASSIGNABLE_ROLES)
  role!: LinkRole;
}
