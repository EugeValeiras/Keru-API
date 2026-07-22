import { AuthPrincipal } from '@keru/core';
import { CareRecordManager } from './care-record.manager';
import { ClinicalRecord } from '../resource-access/entities/clinical-record.entity';
import { PushSubscription } from '../resource-access/entities/push-subscription.entity';
import { RecordVitalsDto } from './dto/record.dto';

/**
 * UC-18 · Push del navegador para alertas, adicional a la campana (constitution §2.7):
 * la campana se persiste en la transacción del registro; el push se despacha después del
 * commit, best-effort — si falla, la campana ya registró todo (NFR-09: nunca al silencio).
 */

const familiar: AuthPrincipal = { accountId: 'acc-fam', email: 'fam@keru.test', role: 'family' };

const MEASURED_AT = new Date('2026-07-20T22:30:00Z');

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
    recordedAt: new Date(),
    ...over,
  }) as ClinicalRecord;

const subscription = (over: Partial<PushSubscription> = {}): PushSubscription =>
  ({
    id: 'sub-1',
    accountId: 'acc-fam',
    endpoint: 'https://push.test/sub-1',
    p256dh: 'p256dh-key',
    auth: 'auth-secret',
    createdAt: new Date(),
    ...over,
  }) as PushSubscription;

function makeManager(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const deps = {
    tx: {
      run: jest.fn(async (fn: (em: unknown) => unknown) => {
        const result = await fn({});
        calls.push('commit');
        return result;
      }),
    },
    careRecordAccess: {
      findByOperationId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(clinical()),
    },
    quarantineAccess: { findByOperationId: jest.fn().mockResolvedValue(null) },
    rangeAccess: {
      getPlausible: jest.fn().mockReturnValue({ min: 0, max: 400, unit: 'bpm' }),
      getApplicableRange: jest.fn().mockReturnValue({ metricKey: 'heart-rate', min: 50, max: 110, unit: 'bpm', version: 1 }),
    },
    alertAccess: {
      createAlert: jest.fn().mockResolvedValue({ id: 'alert-1' }),
      createNotification: jest.fn(async () => {
        calls.push('bell');
      }),
    },
    alertEngine: {
      evaluateVital: jest.fn().mockReturnValue({ outOfRange: true, severity: 'high', message: 'heart-rate 180 fuera de rango' }),
    },
    accountAccess: {
      listLinksForPatient: jest.fn().mockResolvedValue([
        { accountId: 'acc-fam', role: 'consent-holder' },
        { accountId: 'acc-fam-2', role: 'viewer' },
      ]),
    },
    permission: { classifyClinicalWrite: jest.fn().mockResolvedValue('authorized') },
    audit: { record: jest.fn() },
    pushSubscriptions: {
      listForAccounts: jest.fn().mockResolvedValue([subscription()]),
      listForAccount: jest.fn().mockResolvedValue([subscription()]),
      upsertSubscription: jest.fn().mockResolvedValue(subscription()),
      removeByEndpoint: jest.fn().mockResolvedValue(1),
      removeStaleEndpoints: jest.fn().mockResolvedValue(undefined),
    },
    pushTransport: {
      getPublicKey: jest.fn().mockReturnValue('vapid-public'),
      deliver: jest.fn(async () => {
        calls.push('push');
        return [] as string[];
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
  return { manager, deps, calls };
}

describe('UC-18 · una alerta clínica genera push a los suscriptos además de la campana', () => {
  it('Dado un vital fuera de rango, cuando se registra, entonces la campana notifica al círculo y el push sale a sus suscripciones DESPUÉS del commit', async () => {
    const { manager, deps, calls } = makeManager();

    const result = await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect(result.outcome).toBe('recorded');
    // Campana: una notificación por cada vinculado, dentro de la tx (garantía §2.7).
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalledTimes(2);
    // Push: a las suscripciones de TODOS los vinculados, con el payload de la alerta.
    const subsAccess = deps.pushSubscriptions as { listForAccounts: jest.Mock };
    expect(subsAccess.listForAccounts).toHaveBeenCalledWith(['acc-fam', 'acc-fam-2']);
    const transport = deps.pushTransport as { deliver: jest.Mock };
    expect(transport.deliver).toHaveBeenCalledWith(
      [expect.objectContaining({ endpoint: 'https://push.test/sub-1' })],
      expect.objectContaining({ type: 'alert', patientId: 'pat-1', title: 'Alerta clínica' }),
    );
    // Orden: campana → commit → push. El push nunca corre dentro de la transacción.
    expect(calls).toEqual(['bell', 'bell', 'commit', 'push']);
  });

  it('Dado un círculo sin suscripciones, cuando hay alerta, entonces no se intenta push y la campana queda igual', async () => {
    const { manager, deps } = makeManager();
    (deps.pushSubscriptions as { listForAccounts: jest.Mock }).listForAccounts.mockResolvedValue([]);

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect((deps.pushTransport as { deliver: jest.Mock }).deliver).not.toHaveBeenCalled();
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalledTimes(2);
  });
});

describe('UC-18 / §2.7 · la campana sigue registrando todo aunque el push falle', () => {
  it('Dado un transport que revienta, cuando hay alerta, entonces el registro y la campana no se ven afectados', async () => {
    const { manager, deps } = makeManager();
    (deps.pushTransport as { deliver: jest.Mock }).deliver.mockRejectedValue(new Error('push service caído'));

    const result = await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect(result.outcome).toBe('recorded');
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalledTimes(2);
  });

  it('Dado que el listado de suscripciones revienta, cuando hay alerta, entonces el registro igual sale', async () => {
    const { manager, deps } = makeManager();
    (deps.pushSubscriptions as { listForAccounts: jest.Mock }).listForAccounts.mockRejectedValue(new Error('db hiccup'));

    const result = await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect(result.outcome).toBe('recorded');
  });

  it('Dado que el push service reporta suscripciones muertas (404/410), entonces se depuran', async () => {
    const { manager, deps } = makeManager();
    (deps.pushTransport as { deliver: jest.Mock }).deliver.mockResolvedValue(['https://push.test/sub-1']);

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect((deps.pushSubscriptions as { removeStaleEndpoints: jest.Mock }).removeStaleEndpoints).toHaveBeenCalledWith([
      'https://push.test/sub-1',
    ]);
  });
});

describe('UC-20 · una novedad también empuja (espejo de la campana)', () => {
  it('Dada una novedad, cuando se registra, entonces el push sale con type note', async () => {
    const { manager, deps } = makeManager();
    (deps.careRecordAccess as { record: jest.Mock }).record.mockResolvedValue(clinical({ type: 'note', data: { text: 'durmió bien' } }));

    await manager.recordNote('pat-1', { operationId: 'op-2', text: 'durmió bien' } as never, familiar);

    expect((deps.pushTransport as { deliver: jest.Mock }).deliver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'note', title: 'Nueva novedad' }),
    );
  });
});

describe('UC-18 · suscripciones por cuenta y revocables', () => {
  it('getPushConfig expone la clave pública VAPID del transport', () => {
    const { manager } = makeManager();
    expect(manager.getPushConfig()).toEqual({ enabled: true, publicKey: 'vapid-public' });
  });

  it('sin claves VAPID el canal queda deshabilitado (solo campana)', () => {
    const { manager, deps } = makeManager();
    (deps.pushTransport as { getPublicKey: jest.Mock }).getPublicKey.mockReturnValue(null);
    expect(manager.getPushConfig()).toEqual({ enabled: false, publicKey: null });
  });

  it('subscribePush persiste por cuenta (upsert idempotente por endpoint)', async () => {
    const { manager, deps } = makeManager();
    await manager.subscribePush('acc-fam', { endpoint: 'https://push.test/sub-1', p256dh: 'k', auth: 'a' });
    expect((deps.pushSubscriptions as { upsertSubscription: jest.Mock }).upsertSubscription).toHaveBeenCalledWith({
      accountId: 'acc-fam',
      endpoint: 'https://push.test/sub-1',
      p256dh: 'k',
      auth: 'a',
    });
  });

  it('unsubscribePush revoca por (cuenta, endpoint)', async () => {
    const { manager, deps } = makeManager();
    const removed = await manager.unsubscribePush('acc-fam', 'https://push.test/sub-1');
    expect(removed).toBe(1);
    expect((deps.pushSubscriptions as { removeByEndpoint: jest.Mock }).removeByEndpoint).toHaveBeenCalledWith(
      'acc-fam',
      'https://push.test/sub-1',
    );
  });
});
