import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AvailabilitySlot,
  Caregiver,
  CaregiverStatus,
  Certification,
  Rates,
  VerificationBadges,
} from '../../resource-access/entities/caregiver.entity';

/** Detalle completo del cuidador para el back-office (UC-19): incluye la documentación a verificar. */
export class CaregiverDetailDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'deactivated'] }) status!: CaregiverStatus;
  @ApiProperty({ type: [String] }) specialties!: string[];
  @ApiProperty({ type: Object, isArray: true }) certifications!: Certification[];
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
      accountId: c.accountId,
      displayName: c.displayName,
      status: c.status,
      specialties: c.specialties,
      certifications: c.certifications,
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
