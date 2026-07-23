import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WithOperationIdentity } from '@keru/core';
import { METRIC_KEYS } from '../../metric-definitions';

class MetricValueDto {
  @ApiProperty({ enum: METRIC_KEYS, example: 'blood-pressure-systolic' })
  @IsIn(METRIC_KEYS)
  metricKey!: string;

  @ApiProperty({ example: 120 })
  @IsNumber()
  value!: number;
}

/** UC-12 · Registrar signos vitales (una o más métricas en una medición). */
export class RecordVitalsDto extends WithOperationIdentity {
  @ApiPropertyOptional({ description: 'Tiempo de medición ISO. Default: ahora.', example: '2026-07-21T10:00:00Z' })
  @IsOptional()
  @IsString()
  measuredAt?: string;

  @ApiProperty({ type: [MetricValueDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MetricValueDto)
  values!: MetricValueDto[];
}

/** UC-13 · Registrar medicación administrada. */
export class RecordMedicationDto extends WithOperationIdentity {
  @ApiPropertyOptional({ example: '2026-07-21T10:00:00Z' })
  @IsOptional()
  @IsString()
  measuredAt?: string;

  @ApiProperty({ example: 'Enalapril' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  medication!: string;

  @ApiProperty({ example: '10 mg' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dose!: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  schedule?: string;

  @ApiPropertyOptional({ example: 'Tomada con el desayuno' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observations?: string;
}

/** UC-20 · Registrar novedad / comentario. */
export class RecordNoteDto extends WithOperationIdentity {
  @ApiPropertyOptional({ example: '2026-07-21T10:00:00Z' })
  @IsOptional()
  @IsString()
  measuredAt?: string;

  @ApiProperty({ example: 'Durmió bien, comió poco en el almuerzo' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}

/**
 * NFR-38 · Corregir un registro (UC-12 A5): versión nueva con razón obligatoria. El contenido va
 * según el type del ORIGINAL (values para vitals; medication/dose/... para medication; text para
 * note) — el Manager valida la correspondencia.
 */
export class CorrectRecordDto extends WithOperationIdentity {
  @ApiProperty({ example: 'Error de tipeo: la temperatura era 36.8, no 39.8', maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ description: 'Corrige también el tiempo de medición. Default: el del original (NFR-36).', example: '2026-07-21T10:00:00Z' })
  @IsOptional()
  @IsString()
  measuredAt?: string;

  @ApiPropertyOptional({ type: [MetricValueDto], description: 'Si el original es vitals.' })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MetricValueDto)
  values?: MetricValueDto[];

  @ApiPropertyOptional({ example: 'Enalapril', description: 'Si el original es medication.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  medication?: string;

  @ApiPropertyOptional({ example: '10 mg' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dose?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  schedule?: string;

  @ApiPropertyOptional({ example: 'Tomada con el desayuno' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observations?: string;

  @ApiPropertyOptional({ example: 'Durmió bien, comió poco en el almuerzo', description: 'Si el original es note.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text?: string;
}
