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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WithOperationIdentity } from '@keru/core';

export class EmergencyContactDto {
  @ApiProperty({ example: 'María Díaz' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: '+54 11 5555-5555' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phone!: string;

  @ApiPropertyOptional({ example: 'hija' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  relationship?: string;
}

/** UC-01 · Registrar paciente. Incluye operationId (NFR-34, heredado de WithOperationIdentity). */
export class RegisterPatientDto extends WithOperationIdentity {
  @ApiProperty({ example: 'Rosa Díaz' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @ApiProperty({ example: '1948-03-10', description: 'Fecha de nacimiento ISO (YYYY-MM-DD). La edad se deriva de acá.' })
  @IsDateString()
  birthDate!: string;

  @ApiPropertyOptional({ example: 'https://cdn.keru.ar/p/rosa.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @ApiProperty({ example: 'Hipertensión' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  mainCondition!: string;

  @ApiPropertyOptional({ example: '0+' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodGroup?: string;

  @ApiProperty({ example: ['Penicilina'], type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  allergies: string[] = [];

  @ApiProperty({ type: EmergencyContactDto })
  @IsObject()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact!: EmergencyContactDto;
}
