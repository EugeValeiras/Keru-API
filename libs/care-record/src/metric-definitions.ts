/**
 * Catálogo de métricas clínicas (NFR-16/39): métricas como datos. Definición, unidad, bornes de
 * plausibilidad (para rechazar errores de tipeo, A1) y rango por defecto (para evaluar alertas).
 * Los overrides por paciente (NFR-17) son un TODO (UC-18: quién los configura es NEEDS CLARIFICATION).
 */
export interface MetricDefinition {
  key: string;
  label: string;
  unit: string;
  plausible: { min: number; max: number };
  defaultRange: { min: number; max: number };
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  'blood-pressure-systolic': { key: 'blood-pressure-systolic', label: 'Presión sistólica', unit: 'mmHg', plausible: { min: 50, max: 260 }, defaultRange: { min: 90, max: 140 } },
  'blood-pressure-diastolic': { key: 'blood-pressure-diastolic', label: 'Presión diastólica', unit: 'mmHg', plausible: { min: 30, max: 160 }, defaultRange: { min: 60, max: 90 } },
  'heart-rate': { key: 'heart-rate', label: 'Frecuencia cardíaca', unit: 'bpm', plausible: { min: 20, max: 250 }, defaultRange: { min: 60, max: 100 } },
  temperature: { key: 'temperature', label: 'Temperatura', unit: '°C', plausible: { min: 30, max: 45 }, defaultRange: { min: 36, max: 37.5 } },
  'oxygen-saturation': { key: 'oxygen-saturation', label: 'Saturación de oxígeno', unit: '%', plausible: { min: 50, max: 100 }, defaultRange: { min: 92, max: 100 } },
  glucose: { key: 'glucose', label: 'Glucemia', unit: 'mg/dL', plausible: { min: 20, max: 600 }, defaultRange: { min: 70, max: 140 } },
};

export const METRIC_KEYS = Object.keys(METRIC_DEFINITIONS);
