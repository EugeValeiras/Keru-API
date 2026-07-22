import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LinkRole } from '@keru/core';
import { EmergencyContact, Patient } from '../../resource-access/entities/patient.entity';

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

/** UC-22 · Ficha completa del paciente, con el rol del vínculo de quien consulta. */
export class PatientRecordDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Rosa Díaz' })
  fullName!: string;

  @ApiProperty({ example: '1948-03-10', description: 'Fecha de nacimiento ISO (YYYY-MM-DD).' })
  birthDate!: string;

  @ApiProperty({ example: 78, description: 'Edad derivada de la fecha de nacimiento.' })
  age!: number;

  @ApiPropertyOptional({ example: 'https://cdn.keru.app/p/rosa.jpg' })
  photoUrl?: string;

  @ApiProperty({ example: 'Hipertensión' })
  mainCondition!: string;

  @ApiPropertyOptional({ example: '0+' })
  bloodGroup?: string;

  @ApiProperty({ example: ['Penicilina'], type: [String] })
  allergies!: string[];

  @ApiProperty({ type: Object, example: { name: 'María Díaz', phone: '+54 11 5555-5555', relationship: 'hija' } })
  emergencyContact!: EmergencyContact;

  @ApiProperty({ enum: ['consent-holder', 'manager', 'viewer'], description: 'Rol del vínculo de la cuenta que consulta.' })
  linkRole!: LinkRole;

  static from(patient: Patient, age: number, linkRole: LinkRole): PatientRecordDto {
    return {
      id: patient.id,
      fullName: patient.fullName,
      birthDate: patient.birthDate,
      age,
      photoUrl: patient.photoUrl ?? undefined,
      mainCondition: patient.mainCondition,
      bloodGroup: patient.bloodGroup ?? undefined,
      allergies: patient.allergies,
      emergencyContact: patient.emergencyContact,
      linkRole,
    };
  }
}
