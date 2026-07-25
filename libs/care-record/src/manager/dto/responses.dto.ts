import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Notification } from '../../resource-access/entities/notification.entity';
import { QuarantinedRecord } from '../../resource-access/entities/quarantined-record.entity';
import { RecordOutcome } from '../care-record.manager';

export class RecordResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['vitals', 'medication', 'note'] }) type!: string;
  @ApiProperty({ format: 'uuid' }) patientId!: string;
  @ApiProperty() measuredAt!: Date;
  @ApiProperty() authorRole!: string;

  @ApiProperty({
    enum: ['recorded', 'quarantined'],
    description:
      'recorded: entró al historial. quarantined: llegada tardía no autorizada en cuarentena (NFR-30), pendiente de resolución del círculo — nunca se descarta en silencio.',
  })
  status!: 'recorded' | 'quarantined';

  @ApiPropertyOptional({
    nullable: true,
    format: 'uuid',
    description: 'NFR-38: si es una corrección, la versión (registro) que reemplaza — el original queda superseded.',
  })
  supersedesRecordId?: string | null;

  static from(outcome: RecordOutcome): RecordResponseDto {
    if (outcome.outcome === 'recorded') {
      const r = outcome.record;
      return {
        id: r.id,
        type: r.type,
        patientId: r.patientId,
        measuredAt: r.measuredAt,
        authorRole: r.authorRole,
        status: 'recorded',
        supersedesRecordId: r.supersedesRecordId ?? null,
      };
    }
    const q = outcome.quarantined;
    return {
      id: q.id,
      type: q.type,
      patientId: q.patientId,
      measuredAt: q.measuredAt,
      authorRole: q.authorRole,
      status: 'quarantined',
      supersedesRecordId: q.supersedesRecordId ?? null,
    };
  }
}

/** UC-12 A3 · Item de cuarentena visible para el círculo (NFR-30). */
export class QuarantinedRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) patientId!: string;
  @ApiProperty({ enum: ['vitals', 'medication', 'note'] }) type!: string;
  @ApiProperty({ description: 'Tiempo de medición original (NFR-36).' }) measuredAt!: Date;
  @ApiProperty({ description: 'Tiempo de llegada.' }) receivedAt!: Date;
  @ApiProperty() authorAccountId!: string;
  @ApiProperty() authorRole!: string;
  @ApiProperty({ example: 'no-authority-at-measurement' }) reason!: string;
  @ApiProperty({ enum: ['pending', 'approved', 'discarded'] }) status!: string;
  @ApiProperty({ type: Object, description: 'Contenido del registro según type.' }) data!: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true }) resolvedByAccountId!: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid', description: 'Si se aprobó: registro promovido al historial.' })
  approvedRecordId!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid', description: 'NFR-38: si el intento era una corrección, el registro que corrige.' })
  supersedesRecordId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'NFR-38: razón de la corrección en cuarentena.' })
  correctionReason!: string | null;

  static from(q: QuarantinedRecord): QuarantinedRecordDto {
    return {
      id: q.id,
      patientId: q.patientId,
      type: q.type,
      measuredAt: q.measuredAt,
      receivedAt: q.receivedAt,
      authorAccountId: q.authorAccountId,
      authorRole: q.authorRole,
      reason: q.reason,
      status: q.status,
      data: q.data,
      resolvedByAccountId: q.resolvedByAccountId,
      resolvedAt: q.resolvedAt,
      approvedRecordId: q.approvedRecordId,
      supersedesRecordId: q.supersedesRecordId,
      correctionReason: q.correctionReason,
    };
  }
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['alert', 'note'] }) type!: string;
  @ApiProperty({ format: 'uuid' }) patientId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() read!: boolean;
  @ApiProperty() createdAt!: Date;

  static from(n: Notification): NotificationDto {
    return { id: n.id, type: n.type, patientId: n.patientId, title: n.title, body: n.body, read: n.read, createdAt: n.createdAt };
  }
}

/**
 * KER-86 · Página de la campana (UC-18). Cursor descendente por createdAt: la respuesta ya no
 * trae TODAS las notificaciones del destinatario. `nextCursor` opaco alimenta la página siguiente
 * (append en el panel); null cuando no hay más. El contador de no leídas sigue aparte (badge).
 */
export class NotificationPageDto {
  @ApiProperty({ type: NotificationDto, isArray: true })
  items!: NotificationDto[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Cursor opaco de la página siguiente; null si esta es la última. Reenviar como ?cursor=.',
  })
  nextCursor!: string | null;

  static from(page: { items: Notification[]; nextCursor: string | null }): NotificationPageDto {
    return { items: page.items.map(NotificationDto.from), nextCursor: page.nextCursor };
  }
}

/** UC-18 · Resultado de marcar todas como leídas. */
export class MarkAllReadResponseDto {
  @ApiProperty({ example: true })
  ok!: true;

  @ApiProperty({ example: 3, description: 'Cantidad de notificaciones que pasaron de no leída a leída (0 si se repite: idempotente).' })
  updated!: number;
}
