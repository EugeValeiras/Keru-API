import { ApiProperty } from '@nestjs/swagger';

export class UploadedImageDto {
  @ApiProperty({ description: 'URL pública de la imagen subida (usar como photoUrl)' })
  url!: string;
}
