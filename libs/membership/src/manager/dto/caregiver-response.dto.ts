import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AvailabilitySlot,
  Caregiver,
  CaregiverStatus,
  Certification,
  Rates,
  VerificationBadges,
} from '../../resource-access/entities/caregiver.entity';

/**
 * Respuesta de un perfil de cuidador (UC-02 / UC-19). Incluye la ficha completa
 * (foto, certificaciones, disponibilidad, tarifa) para que el dueño vea su
 * perfil y pre-llene la re-postulación (UC-02 A2) sin otra llamada.
 */
export class CaregiverResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  photoUrl?: string | null;

  @ApiProperty({ type: Object, isArray: true })
  certifications!: Certification[];

  @ApiProperty({ type: Object, isArray: true })
  availability!: AvailabilitySlot[];

  @ApiProperty({ type: Object })
  rates!: Rates;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'deactivated'] })
  status!: CaregiverStatus;

  @ApiProperty({ type: [String] })
  specialties!: string[];

  @ApiProperty()
  zone!: string;

  @ApiProperty({ type: [String] })
  modalities!: string[];

  @ApiProperty({ type: Object, example: { certifications: true, identity: false, background: false } })
  badges!: VerificationBadges;

  @ApiPropertyOptional()
  rejectionReason?: string | null;

  static from(c: Caregiver): CaregiverResponseDto {
    return {
      id: c.id,
      displayName: c.displayName,
      photoUrl: c.photoUrl,
      certifications: c.certifications,
      availability: c.availability,
      rates: c.rates,
      status: c.status,
      specialties: c.specialties,
      zone: c.zone,
      modalities: c.modalities,
      badges: c.badges,
      rejectionReason: c.rejectionReason,
    };
  }
}
