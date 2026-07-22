import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Caregiver,
  CaregiverStatus,
  VerificationBadges,
} from '../../resource-access/entities/caregiver.entity';

/** Respuesta de un perfil de cuidador (UC-02 / UC-19). */
export class CaregiverResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

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
      status: c.status,
      specialties: c.specialties,
      zone: c.zone,
      modalities: c.modalities,
      badges: c.badges,
      rejectionReason: c.rejectionReason,
    };
  }
}
