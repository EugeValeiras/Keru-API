import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * UC-23 · Editar el perfil de la cuenta (PATCH /accounts/me). Set parcial de nombre y foto.
 * El email (identidad de login, UC-04) no se edita por esta vía. `photoUrl` se valida igual
 * que el perfil del cuidador (string, máx 500): el cliente sube la imagen antes por
 * `POST /files/images` y manda la URL resultante. PATCH es naturalmente idempotente
 * (fija el estado del nombre/foto): no lleva operationId (NFR-34, aclaración ADR-0002).
 */
export class UpdateAccountDto {
  @ApiPropertyOptional({ example: 'Juana Díaz', minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({
    type: String,
    example: 'http://localhost:4566/keru-media/images/abc.jpg',
    nullable: true,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string | null;
}
