import { Injectable, BadRequestException } from '@nestjs/common';
import { ResourceAccess } from '@keru/core';
import { METRIC_DEFINITIONS } from '../metric-definitions';

export interface ApplicableRange {
  metricKey: string;
  min: number;
  max: number;
  unit: string;
  version: string;
}

/**
 * RangeAccess (constitution §3.1). Provee el rango aplicable y los bornes de plausibilidad por
 * métrica. En el MVP los rangos por defecto salen del catálogo de métricas (NFR-16). Los overrides
 * por paciente (NFR-17) y el versionado efectivo-fechado en DB (NFR-28) son un TODO (UC-18 gap).
 */
@ResourceAccess()
@Injectable()
export class RangeAccess {
  /** Rango aplicable: hoy = default del catálogo. Futuro: estrato -> override por paciente. */
  getApplicableRange(metricKey: string, _patientId?: string): ApplicableRange {
    const def = this.def(metricKey);
    return {
      metricKey,
      min: def.defaultRange.min,
      max: def.defaultRange.max,
      unit: def.unit,
      version: 'default-v1',
    };
  }

  getPlausible(metricKey: string): { min: number; max: number; unit: string } {
    const def = this.def(metricKey);
    return { ...def.plausible, unit: def.unit };
  }

  private def(metricKey: string) {
    const def = METRIC_DEFINITIONS[metricKey];
    if (!def) throw new BadRequestException(`Métrica desconocida: ${metricKey}`);
    return def;
  }
}
