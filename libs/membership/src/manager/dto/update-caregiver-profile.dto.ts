import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WithOperationIdentity } from '@keru/core';
import { AvailabilityDto, MODALITIES, RatesDto } from './register-caregiver.dto';

/**
 * UC-02 A3 · Edición del perfil aprobado. Set parcial: solo los campos que no requieren
 * re-verificación (disponibilidad, tarifas, zona, modalidades). Nombre, especialidades y
 * certificaciones no se editan por esta vía (constitution §7). La FOTO tampoco (ADR-0003): es
 * identidad de la cuenta y se edita por `PATCH /accounts/me` (UC-23). Un cambio de tarifa agrega
 * una versión efectivo-fechada (NFR-03/23), por eso el verbo lleva operationId.
 */
export class UpdateCaregiverProfileDto extends WithOperationIdentity {
  @ApiPropertyOptional({ type: [AvailabilityDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDto)
  availability?: AvailabilityDto[];

  @ApiPropertyOptional({ type: RatesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RatesDto)
  rates?: RatesDto;

  @ApiPropertyOptional({ example: 'Palermo, CABA' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  zone?: string;

  @ApiPropertyOptional({ enum: MODALITIES, isArray: true, example: ['home', 'hospital'] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(MODALITIES, { each: true })
  modalities?: string[];
}
