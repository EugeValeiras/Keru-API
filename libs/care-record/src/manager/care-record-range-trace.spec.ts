import { AuthPrincipal } from '@keru/core';
import { CareRecordManager } from './care-record.manager';
import { ClinicalRecord } from '../resource-access/entities/clinical-record.entity';
import { QuarantinedRecord } from '../resource-access/entities/quarantined-record.entity';
import { METRIC_KEYS } from '../metric-definitions';
import { RecordVitalsDto } from './dto/record.dto';

/**
 * NFR-28 · Traza de versión real: cada evaluación resuelve el rango con asOf = measuredAt y el
 * estrato etario del paciente a esa fecha (NFR-17), y la alerta persiste el id REAL de la
 * RangeVersion aplicada — adiós 'default-v1'. "Por qué disparó / no disparó a las 21:47"
 * siempre tiene respuesta, incluso al re-evaluar una cuarentena aprobada (NFR-36).
 */

const familiar: AuthPrincipal = { accountId: 'acc-fam', email: 'fam@keru.test', role: 'family' };

const MEASURED_AT = new Date('2026-07-20T22:30:00Z');
const RANGE_VERSION_ID = '3c1f9e0a-5b2d-4e8f-9a67-1d2e3f405060';

const vitalsDto = (over: Partial<RecordVitalsDto> = {}): RecordVitalsDto =>
  ({
    operationId: 'op-1',
    measuredAt: MEASURED_AT.toISOString(),
    values: [{ metricKey: 'heart-rate', value: 180 }],
    ...over,
  }) as RecordVitalsDto;

const clinical = (over: Partial<ClinicalRecord> = {}): ClinicalRecord =>
  ({
    id: 'rec-1',
    patientId: 'pat-1',
    type: 'vitals',
    authorAccountId: 'acc-fam',
    authorRole: 'family',
    measuredAt: MEASURED_AT,
    data: { values: [{ metricKey: 'heart-rate', value: 180 }] },
    createdByOperationId: 'op-1',
    ...over,
  }) as ClinicalRecord;

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    careRecordAccess: {
      findByOperationId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(clinical()),
    },
    quarantineAccess: {
      findByOperationId: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      resolve: jest.fn().mockResolvedValue(undefined),
    },
    rangeAccess: {
      getPlausible: jest.fn().mockReturnValue({ min: 0, max: 400, unit: 'bpm' }),
      getApplicableRange: jest
        .fn()
        .mockResolvedValue({ metricKey: 'heart-rate', min: 50, max: 110, unit: 'bpm', version: RANGE_VERSION_ID }),
      appendVersion: jest.fn(async (_input: unknown, operationId: string) => ({
        created: true,
        version: { id: `rv-${operationId}` },
      })),
    },
    alertAccess: {
      createAlert: jest.fn().mockResolvedValue({ id: 'alert-1' }),
      createNotification: jest.fn(async (input: { recipientAccountId: string }) => ({
        id: `n-${input.recipientAccountId}`,
      })),
      supersedePriorUnacked: jest.fn().mockResolvedValue(0),
      recordDeliveryOutcome: jest.fn().mockResolvedValue(undefined),
    },
    alertEngine: {
      evaluateVital: jest.fn().mockReturnValue({ outOfRange: true, severity: 'critical', message: 'fuera de rango' }),
    },
    accountAccess: {
      listLinksForPatient: jest.fn().mockResolvedValue([{ accountId: 'acc-fam', role: 'consent-holder' }]),
      // Nacida el 15/03/1948: 78 años al measuredAt (2026-07-20).
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', birthDate: '1948-03-15' }),
    },
    permission: {
      classifyClinicalWrite: jest.fn().mockResolvedValue('authorized'),
      hasLinkRole: jest.fn().mockResolvedValue(true),
    },
    audit: { record: jest.fn() },
    pushSubscriptions: {
      listForAccounts: jest.fn().mockResolvedValue([]),
      removeStaleEndpoints: jest.fn().mockResolvedValue(undefined),
    },
    pushTransport: {
      getPublicKey: jest.fn().mockReturnValue(null),
      deliver: jest.fn().mockResolvedValue({ attempted: false, delivered: [], failed: [], stale: [] }),
    },
    ...overrides,
  };
  const manager = new CareRecordManager(
    deps.tx as never,
    deps.careRecordAccess as never,
    deps.quarantineAccess as never,
    deps.rangeAccess as never,
    deps.alertAccess as never,
    deps.alertEngine as never,
    deps.accountAccess as never,
    deps.permission as never,
    deps.audit as never,
    deps.pushSubscriptions as never,
    deps.pushTransport as never,
  );
  return { manager, deps };
}

describe('NFR-28 · la alerta persiste el id real de la versión de rango aplicada', () => {
  it('Dado un vital fuera de rango, cuando se registra, entonces el rango se resuelve con asOf=measuredAt y la edad del paciente a esa fecha, y la alerta guarda el id de versión', async () => {
    const { manager, deps } = makeManager();

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    const rangeMock = deps.rangeAccess as { getApplicableRange: jest.Mock };
    expect(rangeMock.getApplicableRange).toHaveBeenCalledWith('heart-rate', {
      ageYears: 78,
      asOf: MEASURED_AT,
    });
    const alertMock = deps.alertAccess as { createAlert: jest.Mock };
    expect(alertMock.createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ rangeVersion: RANGE_VERSION_ID, metricKey: 'heart-rate' }),
      expect.anything(),
    );
    expect(alertMock.createAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ rangeVersion: 'default-v1' }),
      expect.anything(),
    );
  });

  it('Dada una cuarentena aprobada, cuando se re-evalúa, entonces usa el measuredAt ORIGINAL (replay determinista, NFR-36) y persiste la versión aplicada', async () => {
    const originalMeasuredAt = new Date('2026-06-01T08:15:00Z');
    const item: Partial<QuarantinedRecord> = {
      id: 'q-1',
      patientId: 'pat-1',
      type: 'vitals',
      status: 'pending',
      authorAccountId: 'acc-cui',
      authorRole: 'caregiver',
      measuredAt: originalMeasuredAt,
      data: { values: [{ metricKey: 'heart-rate', value: 180 }] },
      createdByOperationId: 'op-q1',
    };
    const { manager, deps } = makeManager();
    (deps.quarantineAccess as { findById: jest.Mock }).findById.mockResolvedValue(item);
    (deps.careRecordAccess as { record: jest.Mock }).record.mockResolvedValue(
      clinical({ measuredAt: originalMeasuredAt, authorAccountId: 'acc-cui', authorRole: 'caregiver' }),
    );

    await manager.approveQuarantined('pat-1', 'q-1', familiar);

    const rangeMock = deps.rangeAccess as { getApplicableRange: jest.Mock };
    expect(rangeMock.getApplicableRange).toHaveBeenCalledWith(
      'heart-rate',
      expect.objectContaining({ asOf: originalMeasuredAt }),
    );
    expect((deps.alertAccess as { createAlert: jest.Mock }).createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ rangeVersion: RANGE_VERSION_ID }),
      expect.anything(),
    );
  });
});

describe('KER-30 · seed de defaults del sistema (append-only, idempotente)', () => {
  it('Dado el arranque, cuando corre el seed, entonces agrega una versión system-default por métrica del catálogo con operationId estable y audita cada insert real', async () => {
    const { manager, deps } = makeManager();

    await manager.ensureSystemRangeDefaults();

    const appendMock = (deps.rangeAccess as { appendVersion: jest.Mock }).appendVersion;
    expect(appendMock).toHaveBeenCalledTimes(METRIC_KEYS.length);
    for (const key of METRIC_KEYS) {
      expect(appendMock).toHaveBeenCalledWith(
        expect.objectContaining({ metricKey: key, scope: 'system-default', ageMinYears: null, ageMaxYears: null }),
        `seed-system-default-${key}`,
      );
    }
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledTimes(METRIC_KEYS.length);
  });

  it('Dado un seed ya materializado, cuando vuelve a correr (reinicio), entonces no re-audita nada (at-most-once por operationId, NFR-34)', async () => {
    const { manager, deps } = makeManager();
    (deps.rangeAccess as { appendVersion: jest.Mock }).appendVersion.mockResolvedValue({
      created: false,
      version: { id: 'rv-existente' },
    });

    await manager.ensureSystemRangeDefaults();

    expect((deps.audit as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });
});
