import { AuthPrincipal } from '@keru/core';
import { CareRecordManager } from './care-record.manager';
import { ClinicalRecord } from '../resource-access/entities/clinical-record.entity';
import { RecordVitalsDto } from './dto/record.dto';

/**
 * KER-34 · Outcome de entrega por destinatario y canal (NFR-26): el push persiste el resultado
 * REAL del envío — delivered si algún endpoint del destinatario aceptó, failed si todos fallaron,
 * y SIN outcome si no hubo intento (sin suscripciones / canal deshabilitado). "Aceptado por el
 * proveedor" nunca se trata como entregado sin resultado. El outcome de la campana (bell,
 * delivered al persistir) lo escribe AlertAccess.createNotification en la misma transacción —
 * ver alert.access.spec.ts.
 */

const familiar: AuthPrincipal = { accountId: 'acc-fam', email: 'fam@keru.test', role: 'family' };

const MEASURED_AT = new Date('2026-07-20T22:30:00Z');

const vitalsDto = (): RecordVitalsDto =>
  ({
    operationId: 'op-1',
    measuredAt: MEASURED_AT.toISOString(),
    values: [{ metricKey: 'heart-rate', value: 180 }],
  }) as RecordVitalsDto;

const clinical = (): ClinicalRecord =>
  ({
    id: 'rec-1',
    patientId: 'pat-1',
    type: 'vitals',
    authorAccountId: 'acc-fam',
    authorRole: 'family',
    measuredAt: MEASURED_AT,
    data: { values: [{ metricKey: 'heart-rate', value: 180 }] },
    createdByOperationId: 'op-1',
    supersedesRecordId: null,
    correctionReason: null,
    supersededAt: null,
    supersededByRecordId: null,
    recordedAt: new Date(),
  }) as ClinicalRecord;

const sub = (accountId: string, endpoint: string) => ({
  id: `sub-${endpoint}`,
  accountId,
  endpoint,
  p256dh: 'k',
  auth: 'a',
  createdAt: new Date(),
});

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    careRecordAccess: {
      findByOperationId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(clinical()),
    },
    quarantineAccess: { findByOperationId: jest.fn().mockResolvedValue(null) },
    rangeAccess: {
      getPlausible: jest.fn().mockReturnValue({ min: 0, max: 400, unit: 'bpm' }),
      getApplicableRange: jest
        .fn()
        .mockResolvedValue({ metricKey: 'heart-rate', min: 50, max: 110, unit: 'bpm', version: 'rv-1' }),
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
      evaluateVital: jest
        .fn()
        .mockReturnValue({ outOfRange: true, severity: 'critical', message: 'heart-rate 180 fuera de rango' }),
    },
    accountAccess: {
      listLinksForPatient: jest.fn().mockResolvedValue([
        { accountId: 'acc-fam', role: 'consent-holder' },
        { accountId: 'acc-fam-2', role: 'viewer' },
      ]),
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', birthDate: '1948-03-15' }),
    },
    permission: { classifyClinicalWrite: jest.fn().mockResolvedValue('authorized') },
    audit: { record: jest.fn() },
    pushSubscriptions: {
      listForAccounts: jest.fn().mockResolvedValue([
        sub('acc-fam', 'https://push.test/ok'),
        sub('acc-fam-2', 'https://push.test/down'),
      ]),
      removeStaleEndpoints: jest.fn().mockResolvedValue(undefined),
    },
    pushTransport: {
      getPublicKey: jest.fn().mockReturnValue('vapid-public'),
      deliver: jest.fn().mockResolvedValue({
        attempted: true,
        delivered: ['https://push.test/ok'],
        failed: ['https://push.test/down'],
        stale: [],
      }),
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

describe('KER-34 · outcome de push por destinatario (NFR-26): resultado REAL del envío', () => {
  it('Dado un destinatario cuyo endpoint entregó y otro cuyo endpoint falló, entonces persiste delivered y failed respectivamente', async () => {
    const { manager, deps } = makeManager();

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    const outcome = (deps.alertAccess as { recordDeliveryOutcome: jest.Mock }).recordDeliveryOutcome;
    expect(outcome).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'n-acc-fam', channel: 'push', status: 'delivered' }),
    );
    expect(outcome).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'n-acc-fam-2', channel: 'push', status: 'failed' }),
    );
  });

  it('Dado un destinatario SIN suscripciones, entonces no se persiste outcome de push para él (no hubo intento)', async () => {
    const { manager, deps } = makeManager();
    (deps.pushSubscriptions as { listForAccounts: jest.Mock }).listForAccounts.mockResolvedValue([
      sub('acc-fam', 'https://push.test/ok'),
    ]);
    (deps.pushTransport as { deliver: jest.Mock }).deliver.mockResolvedValue({
      attempted: true,
      delivered: ['https://push.test/ok'],
      failed: [],
      stale: [],
    });

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    const outcome = (deps.alertAccess as { recordDeliveryOutcome: jest.Mock }).recordDeliveryOutcome;
    expect(outcome).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ notificationId: 'n-acc-fam' }));
  });

  it('Dado el canal push deshabilitado (attempted=false), entonces no se persiste ningún outcome de push', async () => {
    const { manager, deps } = makeManager();
    (deps.pushTransport as { deliver: jest.Mock }).deliver.mockResolvedValue({
      attempted: false,
      delivered: [],
      failed: [],
      stale: [],
    });

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect((deps.alertAccess as { recordDeliveryOutcome: jest.Mock }).recordDeliveryOutcome).not.toHaveBeenCalled();
  });

  it('Dado un destinatario con varios endpoints y AL MENOS uno entregado, entonces su outcome es delivered', async () => {
    const { manager, deps } = makeManager();
    (deps.accountAccess as { listLinksForPatient: jest.Mock }).listLinksForPatient.mockResolvedValue([
      { accountId: 'acc-fam', role: 'consent-holder' },
    ]);
    (deps.pushSubscriptions as { listForAccounts: jest.Mock }).listForAccounts.mockResolvedValue([
      sub('acc-fam', 'https://push.test/phone'),
      sub('acc-fam', 'https://push.test/laptop'),
    ]);
    (deps.pushTransport as { deliver: jest.Mock }).deliver.mockResolvedValue({
      attempted: true,
      delivered: ['https://push.test/laptop'],
      failed: ['https://push.test/phone'],
      stale: [],
    });

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect((deps.alertAccess as { recordDeliveryOutcome: jest.Mock }).recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'n-acc-fam',
        channel: 'push',
        status: 'delivered',
        detail: expect.stringContaining('1/2'),
      }),
    );
  });
});
