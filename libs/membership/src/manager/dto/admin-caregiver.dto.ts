import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** UC-19 · Rechazo de cuenta de cuidador (con motivo informado). */
export class RejectCaregiverDto {
  @ApiProperty({ example: 'Certificación de RCP ilegible' })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  reason!: string;
}

/** OQ-8 · Desactivar cuidador (motivo opcional). */
export class DeactivateCaregiverDto {
  @ApiPropertyOptional({ example: 'Denuncia de un familiar' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}

/** UC-19 · Set de insignias de verificación (los tres niveles son independientes). */
export class SetBadgesDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  certifications?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  identity?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  background?: boolean;
}
