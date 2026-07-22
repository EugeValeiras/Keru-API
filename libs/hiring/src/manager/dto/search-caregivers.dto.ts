import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
const MODALITIES = ['home', 'hospital'];

/** UC-06 · Filtros de búsqueda de cuidadores (query params, combinables). */
export class SearchCaregiversDto {
  @ApiPropertyOptional({ enum: CARE_TYPES })
  @IsOptional()
  @IsIn(CARE_TYPES)
  careType?: string;

  @ApiPropertyOptional({ enum: MODALITIES })
  @IsOptional()
  @IsIn(MODALITIES)
  modality?: string;

  @ApiPropertyOptional({ example: 'Palermo' })
  @IsOptional()
  @IsString()
  zone?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRatePerHour?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxRatePerHour?: number;
}
