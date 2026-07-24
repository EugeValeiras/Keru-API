import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WithOperationIdentity } from '@keru/core';
import { CERTIFICATION_CATALOG_KEYS } from '../../certification-catalog';

/** KER-52 · Respuesta de la subida del documento PRIVADO: la key opaca (no una URL) + su content-type. */
export class UploadedDocumentDto {
  @ApiProperty({ description: 'Key privada del documento (usar como documentKey). NO es una URL pública.', example: 'private/documents/uuid.pdf' })
  documentKey!: string;

  @ApiProperty({ example: 'application/pdf' })
  contentType!: string;
}

/** KER-52 · Entrada del catálogo de certificaciones (UC-02, para la webapp). */
export class CertificationCatalogItemDto {
  @ApiProperty({ example: 'nursing-degree' }) key!: string;
  @ApiProperty({ example: 'Título de Enfermería' }) label!: string;
  @ApiProperty({ description: 'KER-77 · Clave estable del ícono SVG (set Lucide); la webapp la mapea a un SVG local', example: 'stethoscope' }) iconKey!: string;
  @ApiProperty({ description: 'Emoji, fallback textual de iconKey', example: '🩺' }) badgeIcon!: string;
}

/**
 * KER-52 · Agregar una certificación nueva (UC-02 A4). Aditiva: nace `pending`/oculta y entra a la
 * cola del admin (UC-19). Idempotente por `operationId` (NFR-34).
 */
export class AddCertificationDto extends WithOperationIdentity {
  @ApiProperty({ enum: CERTIFICATION_CATALOG_KEYS, example: 'cpr' })
  @IsString()
  @IsIn(CERTIFICATION_CATALOG_KEYS)
  catalogKey!: string;

  @ApiProperty({ example: 'Cruz Roja Argentina' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  institution!: string;

  @ApiProperty({ example: 2021 })
  @IsInt()
  @Min(1950)
  @Max(2100)
  year!: number;

  @ApiProperty({ description: 'Key del documento privado (de POST /files/documents).', example: 'private/documents/uuid.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  documentKey!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  documentContentType!: string;
}

/** KER-52 · Rechazo de una certificación puntual (UC-19 A2), con motivo. */
export class RejectCertificationDto {
  @ApiProperty({ example: 'El documento está ilegible' })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  reason!: string;
}
