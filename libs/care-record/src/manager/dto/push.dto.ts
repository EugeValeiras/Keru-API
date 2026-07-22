import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { PushSubscription } from '../../resource-access/entities/push-subscription.entity';

/** Claves del navegador para cifrar el payload (RFC 8291), tal como las entrega PushSubscription.toJSON(). */
export class PushKeysDto {
  @ApiProperty({ description: 'Clave pública ECDH del navegador.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  p256dh!: string;

  @ApiProperty({ description: 'Secreto de autenticación del navegador.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  auth!: string;
}

/** UC-18 flujo 1 · Alta de suscripción Web Push (idempotente por endpoint único). */
export class SubscribePushDto {
  @ApiProperty({ description: 'URL del push service del navegador.' })
  @IsUrl({ require_tld: false })
  @MaxLength(1024)
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

/** Config pública del canal push: si está habilitado y con qué clave VAPID suscribirse. */
export class PushConfigDto {
  @ApiProperty({ description: 'false si el servidor no tiene claves VAPID: solo campana.' })
  enabled!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Clave pública VAPID (applicationServerKey).' })
  publicKey!: string | null;
}

/** Suscripción push persistida de la cuenta (UC-18: por cuenta y revocable). */
export class PushSubscriptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() endpoint!: string;
  @ApiProperty() createdAt!: Date;

  static from(s: PushSubscription): PushSubscriptionDto {
    return { id: s.id, endpoint: s.endpoint, createdAt: s.createdAt };
  }
}

/** Resultado de revocar: cuántas suscripciones se borraron (0 si se repite: idempotente). */
export class UnsubscribePushResponseDto {
  @ApiProperty({ example: true }) ok!: true;
  @ApiProperty({ example: 1, description: '0 si el endpoint ya no estaba suscripto.' }) removed!: number;
}
