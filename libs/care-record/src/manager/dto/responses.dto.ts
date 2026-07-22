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

  static from(outcome: RecordOutcome): RecordResponseDto {
    if (outcome.outcome === 'recorded') {
      const r = outcome.record;
      return { id: r.id, type: r.type, patientId: r.patientId, measuredAt: r.measuredAt, authorRole: r.authorRole, status: 'recorded' };
    }
    const q = outcome.quarantined;
    return { id: q.id, type: q.type, patientId: q.patientId, measuredAt: q.measuredAt, authorRole: q.authorRole, status: 'quarantined' };
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

/** UC-18 · Resultado de marcar todas como leídas. */
export class MarkAllReadResponseDto {
  @ApiProperty({ example: true })
  ok!: true;

  @ApiProperty({ example: 3, description: 'Cantidad de notificaciones que pasaron de no leída a leída (0 si se repite: idempotente).' })
  updated!: number;
}
