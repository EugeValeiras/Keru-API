import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Caregiver } from '@keru/membership';
import {
  HIRING_TERMINAL_REASONS,
  HiringRequest,
} from '../../resource-access/entities/hiring-request.entity';
import { Assignment } from '../../resource-access/entities/assignment.entity';

/** Tarjeta de cuidador en el listado (UC-06). */
export class CaregiverCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ description: 'Foto de perfil (UC-06)' }) photoUrl?: string;
  @ApiProperty({ type: [String] }) specialties!: string[];
  @ApiProperty() zone!: string;
  @ApiProperty({ type: [String] }) modalities!: string[];
  @ApiProperty() ratePerHour!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: Object }) badges!: Caregiver['badges'];
  @ApiPropertyOptional({ description: 'true si está en los favoritos de la cuenta' }) isFavorite?: boolean;
  @ApiPropertyOptional({
    description: 'Promedio de reseñas reveladas, 0 si no tiene (UC-06 criterio 3)',
  })
  ratingAverage?: number;
  @ApiPropertyOptional({ description: 'Cantidad de reseñas reveladas' }) ratingCount?: number;

  static from(
    c: Caregiver,
    isFavorite?: boolean,
    rating?: { average: number; count: number },
  ): CaregiverCardDto {
    return {
      id: c.id,
      displayName: c.displayName,
      photoUrl: c.photoUrl ?? undefined,
      specialties: c.specialties,
      zone: c.zone,
      modalities: c.modalities,
      ratePerHour: c.rates?.ratePerHour ?? 0,
      currency: c.rates?.currency ?? 'ARS',
      badges: c.badges,
      isFavorite,
      ratingAverage: rating?.average,
      ratingCount: rating?.count,
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

/** Vista sobre la solicitud: qué campos privados se exponen según quién mira (UC-10). */
export interface RequestViewOptions {
  viewer: 'requester' | 'caregiver';
  patientName?: string;
  caregiverName?: string;
}

/** Solicitud de contratación (UC-09/10). */
export class RequestResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) patientId!: string;
  @ApiProperty({ format: 'uuid' }) caregiverId!: string;
  @ApiPropertyOptional({ description: 'Nombre del paciente (visible para el cuidador, UC-10)' })
  patientName?: string;
  @ApiPropertyOptional({ description: 'Nombre del cuidador (visible para el solicitante)' })
  caregiverName?: string;
  @ApiProperty() modality!: string;
  @ApiProperty() startDate!: Date;
  @ApiProperty() endDate!: Date;
  @ApiPropertyOptional() specialRequirements?: string;
  @ApiPropertyOptional({
    type: Object,
    description:
      'Datos de contacto del solicitante. Para el cuidador solo con solicitud aceptada/en curso (UC-10).',
  })
  contactData?: Record<string, unknown>;
  @ApiProperty({ enum: ['pending', 'accepted', 'declined', 'cancelled', 'in-progress', 'completed', 'expired'] }) status!: string;
  @ApiPropertyOptional({
    enum: HIRING_TERMINAL_REASONS,
    description: 'Razón terminal del cierre del servicio (Decouple row 49); solo en estados terminales de servicio.',
  })
  terminalReason?: string;
  @ApiPropertyOptional({
    description: 'Honor-mark de pago declarado por el solicitante tras el cierre (opcional, NFR-10/58).',
  })
  paidDeclaredAt?: Date;
  @ApiPropertyOptional({
    description: 'Momento del no-show reportado por el solicitante (UC-09 A4, KER-32); solo con razón `no-show`.',
  })
  noShowReportedAt?: Date;
  @ApiProperty({ description: 'Tarifa pinneada al solicitar (NFR-03/23)' }) ratePerHourSnapshot!: string;

  static from(r: HiringRequest, view: RequestViewOptions): RequestResponseDto {
    const contactVisible =
      view.viewer === 'requester' || r.status === 'accepted' || r.status === 'in-progress';
    return {
      id: r.id,
      patientId: r.patientId,
      caregiverId: r.caregiverId,
      patientName: view.patientName,
      caregiverName: view.caregiverName,
      modality: r.modality,
      startDate: r.startDate,
      endDate: r.endDate,
      specialRequirements: r.specialRequirements ?? undefined,
      contactData: contactVisible ? r.contactData : undefined,
      status: r.status,
      terminalReason: r.terminalReason ?? undefined,
      paidDeclaredAt: r.paidDeclaredAt ?? undefined,
      noShowReportedAt: r.noShowReportedAt ?? undefined,
      ratePerHourSnapshot: r.ratePerHourSnapshot,
    };
  }
}

/** Diff mínimo de tarifa del rehire (UC-16 A2, NFR-23): pinneada anterior vs vigente re-pinneada. */
export class RehireRateDiffDto {
  @ApiProperty({ description: 'Tarifa pinneada en la última contratación previa con ese cuidador' })
  previousRatePerHour!: string;
  @ApiProperty({ description: 'Tarifa vigente re-pinneada en esta re-solicitud (NFR-03/21)' })
  currentRatePerHour!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'true si la tarifa cambió desde la contratación anterior' })
  changed!: boolean;
}

/** Respuesta del rehire urgente (UC-16 A2): la re-solicitud + el diff de tarifa a la vista. */
export class RehireResponseDto extends RequestResponseDto {
  @ApiProperty({ type: RehireRateDiffDto })
  rateDiff!: RehireRateDiffDto;

  static fromRehire(
    r: HiringRequest,
    view: RequestViewOptions,
    previousRatePerHour: string,
  ): RehireResponseDto {
    return {
      ...RequestResponseDto.from(r, view),
      rateDiff: {
        previousRatePerHour,
        currentRatePerHour: r.ratePerHourSnapshot,
        currency: r.currencySnapshot,
        changed: Number(previousRatePerHour) !== Number(r.ratePerHourSnapshot),
      },
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
