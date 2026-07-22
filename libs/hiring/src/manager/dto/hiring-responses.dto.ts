import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Caregiver } from '@keru/membership';
import { HiringRequest } from '../../resource-access/entities/hiring-request.entity';
import { Assignment } from '../../resource-access/entities/assignment.entity';

/** Tarjeta de cuidador en el listado (UC-06). */
export class CaregiverCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: [String] }) specialties!: string[];
  @ApiProperty() zone!: string;
  @ApiProperty({ type: [String] }) modalities!: string[];
  @ApiProperty() ratePerHour!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: Object }) badges!: Caregiver['badges'];
  @ApiPropertyOptional({ description: 'true si está en los favoritos de la cuenta' }) isFavorite?: boolean;

  static from(c: Caregiver, isFavorite?: boolean): CaregiverCardDto {
    return {
      id: c.id,
      displayName: c.displayName,
      specialties: c.specialties,
      zone: c.zone,
      modalities: c.modalities,
      ratePerHour: c.rates?.ratePerHour ?? 0,
      currency: c.rates?.currency ?? 'ARS',
      badges: c.badges,
      isFavorite,
    };
  }
}

/** Perfil completo del cuidador (UC-07). */
export class CaregiverProfileDto extends CaregiverCardDto {
  @ApiProperty({ type: Object, isArray: true }) certifications!: Caregiver['certifications'];
  @ApiProperty({ type: Object, isArray: true }) availability!: Caregiver['availability'];

  static fromProfile(c: Caregiver): CaregiverProfileDto {
    return {
      ...CaregiverCardDto.from(c),
      certifications: c.certifications,
      availability: c.availability,
    };
  }
}

/** Solicitud de contratación (UC-09/10). */
export class RequestResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) patientId!: string;
  @ApiProperty({ format: 'uuid' }) caregiverId!: string;
  @ApiProperty() modality!: string;
  @ApiProperty() startDate!: Date;
  @ApiProperty() endDate!: Date;
  @ApiProperty({ enum: ['pending', 'accepted', 'declined', 'in-progress', 'finished', 'expired'] }) status!: string;
  @ApiProperty({ description: 'Tarifa pinneada al solicitar (NFR-03/23)' }) ratePerHourSnapshot!: string;

  static from(r: HiringRequest): RequestResponseDto {
    return {
      id: r.id,
      patientId: r.patientId,
      caregiverId: r.caregiverId,
      modality: r.modality,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      ratePerHourSnapshot: r.ratePerHourSnapshot,
    };
  }
}

/** Ítem del historial de cuidadores del paciente (UC-16). */
export class CaregiverHistoryItemDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) caregiverId!: string;
  @ApiPropertyOptional() caregiverName?: string;
  @ApiProperty() periodStart!: Date;
  @ApiProperty() periodEnd!: Date;
  @ApiProperty({ enum: ['active', 'historical'] }) status!: string;

  static from(a: Assignment, caregiverName?: string): CaregiverHistoryItemDto {
    return {
      assignmentId: a.id,
      caregiverId: a.caregiverId,
      caregiverName,
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      status: a.status,
    };
  }
}
