import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WithOperationIdentity } from '@keru/core';

/**
 * UC-09 A3 · Cancelación de la asignación activa (KER-32, NFR-15). La razón terminal la fija
 * el actor que cancela (`cancelled-by-{requester|caregiver|admin}`); la nota es el detalle
 * libre que viaja al audit y a la campana de la contraparte.
 */
export class CancelActiveDto extends WithOperationIdentity {
  @ApiPropertyOptional({ example: 'Viaje imprevisto: no puedo continuar el servicio', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** UC-09 A4 · Registro de no-show por el solicitante (KER-32, NFR-15). */
export class RecordNoShowDto extends WithOperationIdentity {
  @ApiPropertyOptional({
    example: '2026-08-01T08:30:00Z',
    description: 'Momento del no-show; por defecto, el del registro.',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ example: 'No se presentó al inicio del turno', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
