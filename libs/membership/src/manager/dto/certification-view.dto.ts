import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Certification, CertificationStatus } from '../../resource-access/entities/caregiver.entity';
import { CERTIFICATION_CATALOG } from '../../certification-catalog';

/**
 * KER-52 · Vista de una certificación expuesta por la API. NUNCA incluye `documentKey` (el documento
 * es privado; se descarga solo por el endpoint admin de UC-19). Enriquece con la etiqueta/insignia
 * del catálogo. Se usa en tres alcances:
 *  - público (marketplace/ficha, UC-06/07): SOLO certificaciones `approved` — ver `publicCertifications`.
 *  - dueño (`GET /caregivers/me`): todas, con su estado (ve las pendientes/rechazadas propias).
 *  - admin (detalle UC-19): todas, con `hasDocument` para renderizar la descarga + aprobar/rechazar.
 */
export class CertificationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'nursing-degree' }) catalogKey!: string;
  @ApiProperty({ description: 'Nombre visible (catálogo)', example: 'Título de Enfermería' }) label!: string;
  @ApiProperty({ description: 'Ícono de la insignia (catálogo)', example: '🩺' }) badgeIcon!: string;
  @ApiProperty() institution!: string;
  @ApiProperty() year!: number;
  @ApiProperty({ enum: ['pending', 'approved', 'rejected'] }) status!: CertificationStatus;
  @ApiProperty({ description: 'true si status === approved (compat)' }) verified!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewedAt?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) rejectionReason?: string | null;
  @ApiProperty({ description: 'true si tiene documento privado adjunto (para la descarga admin)' })
  hasDocument!: boolean;
}

function labelOf(catalogKey: string): string {
  return CERTIFICATION_CATALOG[catalogKey]?.label ?? catalogKey;
}

function badgeOf(catalogKey: string): string {
  return CERTIFICATION_CATALOG[catalogKey]?.badgeIcon ?? '📄';
}

/** Vista completa de una cert (dueño/admin): todas menos la `documentKey` privada. */
export function toCertificationView(c: Certification): CertificationView {
  return {
    id: c.id,
    catalogKey: c.catalogKey,
    label: labelOf(c.catalogKey),
    badgeIcon: badgeOf(c.catalogKey),
    institution: c.institution,
    year: c.year,
    status: c.status,
    verified: c.status === 'approved',
    reviewedAt: c.reviewedAt ?? null,
    rejectionReason: c.rejectionReason ?? null,
    hasDocument: Boolean(c.documentKey),
  };
}

/** Vista pública (marketplace/ficha): SOLO las aprobadas; sin motivos de rechazo ni provenance. */
export function publicCertifications(certs: Certification[] | undefined): CertificationView[] {
  return (certs ?? [])
    .filter((c) => c.status === 'approved')
    .map((c) => ({
      id: c.id,
      catalogKey: c.catalogKey,
      label: labelOf(c.catalogKey),
      badgeIcon: badgeOf(c.catalogKey),
      institution: c.institution,
      year: c.year,
      status: 'approved' as const,
      verified: true,
      reviewedAt: null,
      rejectionReason: null,
      hasDocument: false,
    }));
}

/** Vista para el dueño/admin: todas las certificaciones, con su estado. */
export function ownerCertifications(certs: Certification[] | undefined): CertificationView[] {
  return (certs ?? []).map(toCertificationView);
}
