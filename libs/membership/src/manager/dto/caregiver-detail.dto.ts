import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AvailabilitySlot,
  Caregiver,
  CaregiverStatus,
  Rates,
  VerificationBadges,
} from '../../resource-access/entities/caregiver.entity';
import { CertificationView, ownerCertifications } from './certification-view.dto';

/**
 * Detalle completo del cuidador para el back-office (UC-19): incluye la documentación a verificar.
 *
 * Minimización de datos (KER-81): NO expone el `accountId` interno del cuidador. Ningún flujo del
 * back-office necesita correlacionar el perfil con su `Account` Keru subyacente (aprobar/rechazar y
 * descargar documentos operan por el `id` del cuidador), así que exponerlo violaba §2 sin razón
 * funcional. El listado admin (`CaregiverResponseDto`) tampoco lo expone.
 */
export class CaregiverDetailDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) photoUrl?: string | null;
  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'deactivated'] }) status!: CaregiverStatus;
  @ApiProperty({ type: [String] }) specialties!: string[];
  @ApiProperty({ type: [CertificationView], description: 'Certificaciones con estado por-cert + hasDocument (para descargar/aprobar). Sin la key privada.' })
  certifications!: CertificationView[];
  @ApiProperty({ type: Object, isArray: true }) availability!: AvailabilitySlot[];
  @ApiProperty({ type: Object }) rates!: Rates;
  @ApiProperty() zone!: string;
  @ApiProperty({ type: [String] }) modalities!: string[];
  @ApiProperty({ type: Object }) badges!: VerificationBadges;
  @ApiPropertyOptional() rejectionReason?: string | null;
  @ApiPropertyOptional() reviewedBy?: string | null;
  @ApiPropertyOptional() reviewedAt?: Date | null;
  @ApiProperty() createdAt!: Date;

  static from(c: Caregiver): CaregiverDetailDto {
    return {
      id: c.id,
      displayName: c.displayName,
      photoUrl: c.photoUrl,
      status: c.status,
      specialties: c.specialties,
      certifications: ownerCertifications(c.certifications),
      availability: c.availability,
      rates: c.rates,
      zone: c.zone,
      modalities: c.modalities,
      badges: c.badges,
      rejectionReason: c.rejectionReason,
      reviewedBy: c.reviewedBy,
      reviewedAt: c.reviewedAt,
      createdAt: c.createdAt,
    };
  }
}

/** Página genérica para listados admin. */
export class PageDto<T> {
  @ApiProperty({ isArray: true }) items!: T[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
