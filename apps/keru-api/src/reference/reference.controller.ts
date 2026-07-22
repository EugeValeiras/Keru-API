import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CATALOGS } from './reference.data';

/** Datos de referencia (catálogos) para los clientes. Público, read-only. */
@ApiTags('Reference')
@Controller('catalogs')
export class ReferenceController {
  @Get()
  @ApiOperation({
    summary: 'Catálogos de la plataforma',
    description:
      'Enumeraciones y catálogo de métricas (con unidad y rangos por defecto) para dropdowns y validación del cliente.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        careTypes: ['elder-care', 'palliative'],
        modalities: ['home', 'hospital'],
        metrics: [{ key: 'heart-rate', label: 'Frecuencia cardíaca', unit: 'bpm' }],
      },
    },
  })
  getCatalogs() {
    return CATALOGS;
  }
}
