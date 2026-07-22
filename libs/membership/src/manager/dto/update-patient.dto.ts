import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmergencyContactDto } from './register-patient.dto';

/**
 * UC-22 · Editar la ficha del paciente. Todos los campos son opcionales (set parcial);
 * mismas validaciones que RegisterPatientDto. Sin operationId: el set parcial es
 * naturalmente idempotente (NFR-34, aclaración).
 */
export class UpdatePatientDto {
  @ApiPropertyOptional({ example: 'Rosa Díaz' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({ example: '1948-03-10', description: 'Fecha de nacimiento ISO (YYYY-MM-DD). No puede ser futura.' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({ example: 'https://cdn.keru.app/p/rosa.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @ApiPropertyOptional({ example: 'Hipertensión' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  mainCondition?: string;

  @ApiPropertyOptional({ example: '0+' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodGroup?: string;

  @ApiPropertyOptional({ example: ['Penicilina'], type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({ type: EmergencyContactDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto;
}
