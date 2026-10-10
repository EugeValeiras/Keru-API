import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CERTIFICATION_CATALOG_KEYS } from '../../certification-catalog';
import { CARE_TYPES } from './register-caregiver.dto';
import { UpdateCaregiverProfileDto } from './update-caregiver-profile.dto';

/** UC-19 · Rechazo de cuenta de cuidador (con motivo informado). */
export class RejectCaregiverDto {
  @ApiProperty({ example: 'Certificación de RCP ilegible' })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  reason!: string;
}

/** OQ-8 · Desactivar cuidador (motivo opcional). */
export class DeactivateCaregiverDto {
  @ApiPropertyOptional({ example: 'Denuncia de un familiar' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}

/** UC-19 · Set de insignias de verificación (los tres niveles son independientes). */
export class SetBadgesDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  certifications?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  identity?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  background?: boolean;
}

/**
 * #49 (UC-19 A3) · Edición de datos del cuidador por el ADMINISTRADOR (`PATCH /admin/caregivers/:id`).
 * Set parcial, todo opcional: solo las claves presentes se escriben. Extiende el patch del cuidador
 * aprobado (disponibilidad, tarifas, zona, modalidades — UC-02 A3) con lo que el cuidador NO puede
 * tocar: la **identidad** (`displayName`/`photoUrl`, que viven en la `Account` — ADR-0003) y las
 * **especialidades** (quien edita es el verificador: no hay re-verificación, constitution §7 acotado).
 * Funciona en cualquier estado del cuidador y nunca lleva status/badges/provenance (tienen sus verbos).
 * `photoUrl` se valida en el Manager contra el patrón de `POST /files/images` (como UC-23 A4); `null`
 * quita la foto. Lleva `operationId` porque un cambio de tarifa agrega una versión efectivo-fechada
 * (NFR-03/23, NFR-34). Exige rol admin + step-up (NFR-33).
 */
export class AdminUpdateCaregiverDto extends UpdateCaregiverProfileDto {
  @ApiPropertyOptional({ example: 'Laura Gómez', minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'URL devuelta por POST /files/images (se valida contra su patrón); null quita la foto.',
    example: '/media/images/3f2c1a9e-7d4b-4a1c-9d2e-5b6f7a8c9d0e.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string | null;

  @ApiPropertyOptional({ enum: CARE_TYPES, isArray: true, example: ['elder-care', 'palliative'] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CARE_TYPES, { each: true })
  specialties?: string[];
}

/**
 * #49 (UC-19 A3) · Corrección de una certificación EXISTENTE por el administrador
 * (`PATCH /admin/caregivers/:id/certifications/:certId`): tipo del catálogo, institución y/o año.
 * Set parcial. No cambia el estado de la certificación ni su documento privado (reemplazarlo o
 * agregar una nueva sigue siendo UC-02 A4, lo hace el cuidador). Exige rol admin + step-up.
 */
export class AdminUpdateCertificationDto {
  @ApiPropertyOptional({ enum: CERTIFICATION_CATALOG_KEYS, example: 'cpr' })
  @IsOptional()
  @IsString()
  @IsIn(CERTIFICATION_CATALOG_KEYS)
  catalogKey?: string;

  @ApiPropertyOptional({ example: 'Cruz Roja Argentina', minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  institution?: string;

  @ApiPropertyOptional({ example: 2021, minimum: 1950, maximum: 2100 })
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;
}
