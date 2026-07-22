import { ApiProperty } from '@nestjs/swagger';
import { ClinicalRecord } from '../../resource-access/entities/clinical-record.entity';
import { Notification } from '../../resource-access/entities/notification.entity';

export class RecordResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['vitals', 'medication', 'note'] }) type!: string;
  @ApiProperty({ format: 'uuid' }) patientId!: string;
  @ApiProperty() measuredAt!: Date;
  @ApiProperty() authorRole!: string;

  static from(r: ClinicalRecord): RecordResponseDto {
    return { id: r.id, type: r.type, patientId: r.patientId, measuredAt: r.measuredAt, authorRole: r.authorRole };
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
