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
import { AuthPrincipal, CurrentAccount, JwtAuthGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { UploadedImageDto } from './manager/dto/uploaded-image.dto';
import { UploadedDocumentDto } from './manager/dto/certification-io.dto';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // KER-52: PDF/imagen del certificado

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

  @Post('documents')
  @ApiOperation({
    summary: 'KER-52 · Subir documento PRIVADO de certificación (PDF/imagen, máx 10MB) → documentKey (NO URL pública)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: UploadedDocumentDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async uploadDocument(
    @CurrentAccount() account: AuthPrincipal,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadedDocumentDto> {
    if (!file) {
      throw new BadRequestException('Falta el archivo (campo "file")');
    }
    return this.membership.uploadDocument(file.buffer, file.mimetype, account.accountId);
  }
}
