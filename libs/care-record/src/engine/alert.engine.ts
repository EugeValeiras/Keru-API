import { Injectable } from '@nestjs/common';
import { Engine } from '@keru/core';
import { ApplicableRange } from '../resource-access/range.access';

export interface AlertEvaluation {
  outOfRange: boolean;
  severity: 'critical' | 'info';
  message: string;
}

/**
 * AlertEngine (constitution §3.1). Evaluación pura: valor vs versión de rango aplicable. Sin estado,
 * sin efectos. Clasifica severidad (fuera-de-rango = critical). Evalúa contra el rango que le pasa
 * el Manager (obtenido del path de escritura, nunca del read model — NFR-24).
 */
@Engine()
@Injectable()
export class AlertEngine {
  evaluateVital(value: number, range: ApplicableRange): AlertEvaluation {
    const outOfRange = value < range.min || value > range.max;
    return {
      outOfRange,
      severity: outOfRange ? 'critical' : 'info',
      message: outOfRange
        ? `${range.metricKey} fuera de rango: ${value} ${range.unit} (esperado ${range.min}-${range.max})`
        : `${range.metricKey} en rango`,
    };
  }
}
