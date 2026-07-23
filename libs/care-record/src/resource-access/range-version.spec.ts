import { ageInYearsAt, pickApplicableVersion } from './range.access';
import { RangeVersion } from './entities/range-version.entity';

/**
 * NFR-17 · Selección determinista del estrato etario + NFR-28 · versiones efectivo-fechadas.
 * El stressor #29 (pediátrico) es el quiet assumption más peligroso del sistema: un rango de
 * adulto aplicado a un niño. Estos tests fijan la semántica de selección: estrato específico >
 * default abierto, vigencia más reciente, desempate total determinista.
 */

let seq = 0;
const version = (over: Partial<RangeVersion>): RangeVersion =>
  ({
    id: `rv-${++seq}`,
    metricKey: 'heart-rate',
    scope: 'system-default',
    ageMinYears: null,
    ageMaxYears: null,
    min: 60,
    max: 100,
    unit: 'bpm',
    effectiveFrom: new Date('1970-01-01T00:00:00Z'),
    authorAccountId: null,
    authorRole: null,
    createdByOperationId: `op-${seq}`,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as RangeVersion;

describe('NFR-17 · pickApplicableVersion: estratos etarios deterministas', () => {
  it('Dado un estrato pediátrico y un default abierto, cuando el paciente tiene 5 años, entonces gana el estrato específico', () => {
    const open = version({ id: 'rv-open', min: 60, max: 100 });
    const pediatric = version({ id: 'rv-ped', ageMinYears: 1, ageMaxYears: 12, min: 80, max: 130 });

    const picked = pickApplicableVersion([open, pediatric], 5);

    expect(picked?.id).toBe('rv-ped');
    expect(picked?.max).toBe(130);
  });

  it('Dado el mismo par, cuando el paciente tiene 40 años, entonces el estrato pediátrico NO aplica y gana el default', () => {
    const open = version({ id: 'rv-open' });
    const pediatric = version({ id: 'rv-ped', ageMinYears: 1, ageMaxYears: 12 });

    expect(pickApplicableVersion([pediatric, open], 40)?.id).toBe('rv-open');
  });

  it('El estrato es [min, max): a la edad exacta del borne superior ya no aplica; en el inferior sí', () => {
    const open = version({ id: 'rv-open' });
    const pediatric = version({ id: 'rv-ped', ageMinYears: 1, ageMaxYears: 12 });

    expect(pickApplicableVersion([pediatric, open], 12)?.id).toBe('rv-open'); // cumplió 12: afuera
    expect(pickApplicableVersion([pediatric, open], 1)?.id).toBe('rv-ped'); // cumplió 1: adentro
  });

  it('Un estrato con dos bornes es más específico que uno con un solo borne', () => {
    const halfOpen = version({ id: 'rv-half', ageMinYears: 65, ageMaxYears: null });
    const closed = version({ id: 'rv-closed', ageMinYears: 65, ageMaxYears: 80 });

    expect(pickApplicableVersion([halfOpen, closed], 70)?.id).toBe('rv-closed');
  });

  it('A igual especificidad gana la vigencia más reciente (NFR-28: nunca se sobrescribe, se agrega)', () => {
    const original = version({ id: 'rv-v1', effectiveFrom: new Date('2026-01-01T00:00:00Z'), max: 100 });
    const corrected = version({ id: 'rv-v2', effectiveFrom: new Date('2026-06-01T00:00:00Z'), max: 110 });

    expect(pickApplicableVersion([original, corrected], 40)?.id).toBe('rv-v2');
  });

  it('El orden de entrada no cambia el resultado (selección determinista, NFR-17)', () => {
    const rows = [
      version({ id: 'rv-a' }),
      version({ id: 'rv-b', ageMinYears: 0, ageMaxYears: 18 }),
      version({ id: 'rv-c', effectiveFrom: new Date('2026-05-01T00:00:00Z') }),
    ];
    const forward = pickApplicableVersion([...rows], 10)?.id;
    const backward = pickApplicableVersion([...rows].reverse(), 10)?.id;

    expect(forward).toBe(backward);
  });

  it('Sin versión aplicable devuelve null (el RA lo convierte en falla fuerte, nunca fallback silencioso)', () => {
    const pediatric = version({ id: 'rv-ped', ageMinYears: 0, ageMaxYears: 12 });

    expect(pickApplicableVersion([pediatric], 30)).toBeNull();
    expect(pickApplicableVersion([], 5)).toBeNull();
  });
});

describe('NFR-17 · ageInYearsAt: años cumplidos al momento de la medición', () => {
  it('cuenta años cumplidos, no calendario: el día antes del cumpleaños todavía no sumó', () => {
    expect(ageInYearsAt('2014-07-24', new Date('2026-07-23T12:00:00Z'))).toBe(11);
    expect(ageInYearsAt('2014-07-23', new Date('2026-07-23T12:00:00Z'))).toBe(12);
  });

  it('un bebé de meses tiene 0 años (estrato neonatal/pediátrico posible)', () => {
    expect(ageInYearsAt('2026-03-01', new Date('2026-07-23T00:00:00Z'))).toBe(0);
  });

  it('la edad se evalúa al measuredAt, no a hoy: un registro histórico usa la edad de entonces', () => {
    expect(ageInYearsAt('2010-01-01', new Date('2020-06-01T00:00:00Z'))).toBe(10);
    expect(ageInYearsAt('2010-01-01', new Date('2026-06-01T00:00:00Z'))).toBe(16);
  });
});
