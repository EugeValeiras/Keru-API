import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WithOperationIdentity } from '@keru/core';

const CARE_TYPES = [
  'elder-care',
  'post-surgical',
  'chronic-illness',
  'disability',
  'palliative',
  'pediatric',
  'rehabilitation',
  'companionship',
];
export const MODALITIES = ['home', 'hospital'];

export class CertificationDto {
  @ApiProperty({ example: 'Enfermería' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  type!: string;

  // A1: institución y año son obligatorios.
  @ApiProperty({ example: 'Universidad de Buenos Aires' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  institution!: string;

  @ApiProperty({ example: 2015 })
  @IsInt()
  @Min(1950)
  @Max(2100)
  year!: number;
}

export class AvailabilityDto {
  @ApiProperty({ example: 1, description: '0=domingo .. 6=sábado' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '08:00' })
  @IsString()
  from!: string;

  @ApiProperty({ example: '16:00' })
  @IsString()
  to!: string;
}

export class RatesDto {
  @ApiProperty({ example: 3500 })
  @IsNumber()
  @Min(0)
  ratePerHour!: number;

  @ApiPropertyOptional({ example: 'ARS', default: 'ARS' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: 'Incluye acompañamiento nocturno' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/** UC-02 · Registrar cuidador. La cuenta (rol caregiver) crea su perfil profesional. */
export class RegisterCaregiverDto extends WithOperationIdentity {
  /**
   * @deprecated ADR-0003 · La identidad (nombre) vive en la `Account`, no en el perfil. El alta ya
   * no pide el nombre (usa el de la cuenta); si un cliente lo envía, se ignora.
   */
  @ApiPropertyOptional({ deprecated: true, description: 'Ignorado (ADR-0003): el nombre lo aporta la cuenta.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  /**
   * Foto de perfil (opcional). ADR-0003: la foto es identidad de la `Account` — si se envía al
   * registrar, se guarda en la cuenta (fuente única), no en el perfil.
   */
  @ApiPropertyOptional({ example: 'http://localhost:4566/keru-media/images/abc.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @ApiProperty({ enum: CARE_TYPES, isArray: true, example: ['elder-care', 'palliative'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CARE_TYPES, { each: true })
  specialties!: string[];

  @ApiProperty({ type: [CertificationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificationDto)
  certifications!: CertificationDto[];

  @ApiProperty({ type: [AvailabilityDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDto)
  availability!: AvailabilityDto[];

  @ApiProperty({ type: RatesDto })
  @ValidateNested()
  @Type(() => RatesDto)
  rates!: RatesDto;

  @ApiProperty({ example: 'Palermo, CABA' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  zone!: string;

  @ApiProperty({ enum: MODALITIES, isArray: true, example: ['home', 'hospital'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(MODALITIES, { each: true })
  modalities!: string[];
}
