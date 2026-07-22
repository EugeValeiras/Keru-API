import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Respuesta de un perfil de paciente (UC-01 / UC-22). */
export class PatientResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Rosa Díaz' })
  fullName!: string;

  @ApiProperty({ example: 78, description: 'Edad derivada de la fecha de nacimiento.' })
  age!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Si se detectó un posible duplicado del mismo humano (residuo #21), su id; el cliente puede ofrecer vincular/mergear.',
  })
  duplicateCandidateId?: string;
}
