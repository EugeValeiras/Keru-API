import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { UploadedImageDto } from './manager/dto/uploaded-image.dto';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Subida de imágenes de perfil (UC-01 foto del paciente, UC-02 foto del cuidador).
 * El cliente sube la imagen, recibe la URL y la manda como photoUrl en el alta.
 */
@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly membership: MembershipManager) {}

  @Post('images')
  @ApiOperation({ summary: 'Subir imagen de perfil (jpeg/png/webp, máx 5MB) → URL pública' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: UploadedImageDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<UploadedImageDto> {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file")');
    }
    return this.membership.uploadImage(file.buffer, file.mimetype);
  }
}
