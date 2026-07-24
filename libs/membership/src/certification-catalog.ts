/**
 * KER-52 · Catálogo finito de tipos de certificación del cuidador (UC-02/UC-19).
 *
 * Fuente de verdad del catálogo (patrón `metric-definitions.ts`): la validación "solo tipos del
 * catálogo" y las etiquetas/insignias que ve el usuario se resuelven desde acá. La migración
 * `CertificationCatalog` seedea la tabla `certification_catalog` con estas mismas filas (patrón
 * `range_version`), que `CertificationCatalogAccess` expone por el endpoint GET del catálogo.
 * Mantener ambos en sync (misma convención que metric-definitions ↔ range_version).
 *
 * Cada entrada tiene su **insignia propia** (ícono + nombre visible): al aprobar una certificación
 * (UC-19), esa insignia se muestra en el marketplace/ficha (UC-06/07).
 */
export interface CertificationCatalogItem {
  /** Clave estable, referenciada por `Certification.catalogKey`. */
  key: string;
  /** Nombre visible de la certificación. */
  label: string;
  /**
   * KER-77 · Clave estable del ícono SVG diseñado de la insignia (nombre del set Lucide, brand book §5).
   * La webapp la mapea a un SVG bundleado localmente (`kr-cert-icon`); NO es una URL externa.
   */
  iconKey: string;
  /**
   * Ícono de la insignia asociada (emoji). KER-77: queda como FALLBACK textual (contextos donde no se
   * puede renderizar SVG inline, p.ej. un `<option>`, y usos text-only). El glifo visible es `iconKey`.
   */
  badgeIcon: string;
}

export const CERTIFICATION_CATALOG: Record<string, CertificationCatalogItem> = {
  'nursing-degree': { key: 'nursing-degree', label: 'Título de Enfermería', iconKey: 'stethoscope', badgeIcon: '🩺' },
  'nursing-assistant': { key: 'nursing-assistant', label: 'Auxiliar de Enfermería', iconKey: 'syringe', badgeIcon: '💉' },
  cpr: { key: 'cpr', label: 'RCP', iconKey: 'heart-pulse', badgeIcon: '❤️' },
  'first-aid': { key: 'first-aid', label: 'Primeros Auxilios', iconKey: 'ambulance', badgeIcon: '🚑' },
  'geriatric-care': { key: 'geriatric-care', label: 'Cuidado Geriátrico', iconKey: 'accessibility', badgeIcon: '🧓' },
  'palliative-care': { key: 'palliative-care', label: 'Cuidados Paliativos', iconKey: 'bird', badgeIcon: '🕊️' },
  'dementia-care': { key: 'dementia-care', label: 'Cuidado de Demencia / Alzheimer', iconKey: 'brain', badgeIcon: '🧠' },
  'physical-therapy': { key: 'physical-therapy', label: 'Kinesiología', iconKey: 'bone', badgeIcon: '🦵' },
  'therapeutic-companion': { key: 'therapeutic-companion', label: 'Acompañante Terapéutico', iconKey: 'heart-handshake', badgeIcon: '🤝' },
  'pediatric-nursing': { key: 'pediatric-nursing', label: 'Enfermería Pediátrica', iconKey: 'baby', badgeIcon: '🧸' },
  'diabetes-nutrition': { key: 'diabetes-nutrition', label: 'Diabetes y Nutrición', iconKey: 'apple', badgeIcon: '🍎' },
};

export const CERTIFICATION_CATALOG_KEYS = Object.keys(CERTIFICATION_CATALOG);

/** true si `key` pertenece al catálogo finito (validación "fuera de catálogo → rechazado"). */
export function isCertificationCatalogKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CERTIFICATION_CATALOG, key);
}
