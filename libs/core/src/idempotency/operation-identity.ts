import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * NFR-34 (idempotencia de plataforma).
 * Todo verbo mutante de un ResourceAccess DEBE recibir una identidad de operación
 * provista por el cliente. El efecto es at-most-once: un reintento con el mismo
 * operationId colapsa sobre el efecto original sin duplicar.
 *
 * Los DTOs de comandos mutantes extienden este mixin (o incluyen `operationId`),
 * y la fitness function de CI verifica que ningún verbo mutante lo omita.
 */
export class WithOperationIdentity {
  @ApiProperty({
    description:
      'Identidad de operación provista por el cliente (NFR-34). Un reintento con el mismo valor no duplica el efecto.',
    example: 'op-8f3a2c1e',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  operationId!: string;
}

export interface OperationIdentity {
  readonly operationId: string;
}
