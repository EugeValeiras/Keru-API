import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WithOperationIdentity } from '@keru/core';

const MODALITIES = ['home', 'hospital'];

/** UC-09 · Crear solicitud de contratación. Pertenece a UN paciente (I4). */
export class CreateRequestDto extends WithOperationIdentity {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  patientId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  caregiverId!: string;

  @ApiProperty({ enum: MODALITIES })
  @IsIn(MODALITIES)
  modality!: string;

  @ApiProperty({ example: '2026-08-01T08:00:00Z' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-08-15T18:00:00Z' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ example: 'Requiere movilidad reducida' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialRequirements?: string;

  @ApiProperty({ example: { phone: '+54 11 5555-5555' } })
  @IsObject()
  contactData!: Record<string, unknown>;
}
