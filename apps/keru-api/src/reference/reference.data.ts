/**
 * Datos de referencia (catálogos) para los clientes. Estáticos en el MVP para desbloquear a la
 * app móvil (dropdowns, validación, unidades). A futuro, los que son configurables migran a su
 * dominio dueño (métricas/rangos -> CareRecord/RangeAccess, NFR-16; zonas -> Hiring/ZoneAccess).
 */

export const CARE_TYPES = [
  'elder-care',
  'post-surgical',
  'chronic-illness',
  'disability',
  'palliative',
  'pediatric',
  'rehabilitation',
  'companionship',
] as const;

export const MODALITIES = ['home', 'hospital'] as const;

export const BLOOD_GROUPS = ['0-', '0+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;

export const ACCOUNT_ROLES = ['patient', 'family', 'caregiver', 'admin'] as const;

export const LINK_ROLES = ['consent-holder', 'manager', 'viewer'] as const;

export const HIRING_STATES = ['pending', 'accepted', 'declined', 'in-progress', 'completed'] as const;

/** Razones terminales del cierre del servicio (NFR-12, Decouple row 49; enum extensible — KER-32). */
export const HIRING_TERMINAL_REASONS = [
  'completed',
  'cancelled-by-requester',
  'cancelled-by-caregiver',
  'cancelled-by-admin',
  'no-show',
  'end-of-life',
] as const;

export const VERIFICATION_BADGES = ['certifications', 'identity', 'background'] as const;

/** Catálogo de métricas clínicas (NFR-16/39): definición, unidad y rango plausible por defecto. */
export const METRIC_CATALOG = [
  { key: 'blood-pressure-systolic', label: 'Presión sistólica', unit: 'mmHg', plausible: { min: 50, max: 260 }, defaultRange: { min: 90, max: 140 } },
  { key: 'blood-pressure-diastolic', label: 'Presión diastólica', unit: 'mmHg', plausible: { min: 30, max: 160 }, defaultRange: { min: 60, max: 90 } },
  { key: 'heart-rate', label: 'Frecuencia cardíaca', unit: 'bpm', plausible: { min: 20, max: 250 }, defaultRange: { min: 60, max: 100 } },
  { key: 'temperature', label: 'Temperatura', unit: '°C', plausible: { min: 30, max: 45 }, defaultRange: { min: 36, max: 37.5 } },
  { key: 'oxygen-saturation', label: 'Saturación de oxígeno', unit: '%', plausible: { min: 50, max: 100 }, defaultRange: { min: 92, max: 100 } },
  { key: 'glucose', label: 'Glucemia', unit: 'mg/dL', plausible: { min: 20, max: 600 }, defaultRange: { min: 70, max: 140 } },
] as const;

export const CATALOGS = {
  careTypes: CARE_TYPES,
  modalities: MODALITIES,
  bloodGroups: BLOOD_GROUPS,
  accountRoles: ACCOUNT_ROLES,
  linkRoles: LINK_ROLES,
  hiringStates: HIRING_STATES,
  hiringTerminalReasons: HIRING_TERMINAL_REASONS,
  verificationBadges: VERIFICATION_BADGES,
  metrics: METRIC_CATALOG,
};
