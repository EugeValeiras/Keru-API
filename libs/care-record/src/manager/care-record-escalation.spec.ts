import { AuthPrincipal } from '@keru/core';
import { CareRecordManager } from './care-record.manager';
import { ClinicalRecord } from '../resource-access/entities/clinical-record.entity';
import { Alert } from '../resource-access/entities/alert.entity';
import { RecordVitalsDto } from './dto/record.dto';

/**
 * KER-34 · Escalación de críticas no acusadas + supersede (NFR-11/26/27, anti-T7):
 * el barrido reclama (claim pattern: una sola vez) las críticas sin acuse más viejas que el
 * umbral y re-notifica al círculo POR PUSH — la campana original sigue sin leer, no se duplica.
 * Una alerta nueva del mismo (paciente, métrica) supersede a la anterior no acusada en la misma
 * transacción: las superseded nunca escalan — un backlog no se convierte en tormenta (T7).
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

const criticalAlert = (over: Partial<Alert> = {}): Alert =>
  ({
    id: 'alert-1',
    patientId: 'pat-1',
    recordId: 'rec-1',
    metricKey: 'heart-rate',
    value: '180',
    unit: 'bpm',
    severity: 'critical',
    rangeVersion: 'rv-1',
    message: 'heart-rate 180 fuera de rango',
    escalatedAt: null,
    supersededAt: null,
    supersededByAlertId: null,
    createdAt: new Date(Date.now() - 20 * 60_000),
    ...over,
  }) as Alert;

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
      getApplicableRange: jest
        .fn()
        .mockResolvedValue({ metricKey: 'heart-rate', min: 50, max: 110, unit: 'bpm', version: 'rv-1' }),
    },
    alertAccess: {
      createAlert: jest.fn().mockResolvedValue(criticalAlert()),
      createNotification: jest.fn(async (input: { recipientAccountId: string }) => {
        calls.push('bell');
        return { id: `n-${input.recipientAccountId}` };
      }),
      supersedePriorUnacked: jest.fn(async () => {
        calls.push('supersede');
        return 1;
      }),
      claimEscalatable: jest.fn().mockResolvedValue([]),
      listNotificationsForAlert: jest.fn().mockResolvedValue([]),
      recordDeliveryOutcome: jest.fn().mockResolvedValue(undefined),
    },
    alertEngine: {
      evaluateVital: jest
        .fn()
        .mockReturnValue({ outOfRange: true, severity: 'critical', message: 'heart-rate 180 fuera de rango' }),
    },
    accountAccess: {
      listLinksForPatient: jest.fn().mockResolvedValue([{ accountId: 'acc-fam', role: 'consent-holder' }]),
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', birthDate: '1948-03-15' }),
    },
    permission: { classifyClinicalWrite: jest.fn().mockResolvedValue('authorized') },
    audit: { record: jest.fn() },
    pushSubscriptions: {
      listForAccounts: jest.fn().mockResolvedValue([
        { id: 'sub-1', accountId: 'acc-fam', endpoint: 'https://push.test/sub-1', p256dh: 'k', auth: 'a' },
      ]),
      removeStaleEndpoints: jest.fn().mockResolvedValue(undefined),
    },
    pushTransport: {
      getPublicKey: jest.fn().mockReturnValue('vapid-public'),
      deliver: jest.fn(async () => {
        calls.push('push');
        return { attempted: true, delivered: ['https://push.test/sub-1'], failed: [], stale: [] };
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

describe('KER-34 · supersede (anti-T7): la alerta nueva reemplaza a la anterior no acusada', () => {
  it('Dado un vital crítico, cuando se registra, entonces supersede a las críticas previas del mismo (paciente, métrica) DENTRO de la transacción', async () => {
    const { manager, deps, calls } = makeManager();

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    const alertAccess = deps.alertAccess as { supersedePriorUnacked: jest.Mock };
    expect(alertAccess.supersedePriorUnacked).toHaveBeenCalledWith('pat-1', 'heart-rate', 'alert-1', expect.anything());
    // El supersede corre antes del commit: atómico con la alerta nueva (anti-T7).
    expect(calls.indexOf('supersede')).toBeLessThan(calls.indexOf('commit'));
  });

  it('Dada una alerta no crítica, cuando se registra, entonces NO supersede nada (solo las críticas escalan)', async () => {
    const { manager, deps } = makeManager();
    (deps.alertEngine as { evaluateVital: jest.Mock }).evaluateVital.mockReturnValue({
      outOfRange: true,
      severity: 'info',
      message: 'leve',
    });

    await manager.recordVitals('pat-1', vitalsDto(), familiar);

    expect((deps.alertAccess as { supersedePriorUnacked: jest.Mock }).supersedePriorUnacked).not.toHaveBeenCalled();
  });
});

describe('KER-34 · escalación de críticas no acusadas (NFR-11): re-notifica al círculo por push', () => {
  it('Dada una crítica reclamada, cuando barre, entonces re-pushea al círculo, persiste el outcome como escalación y audita', async () => {
    const { manager, deps } = makeManager();
    const alertAccess = deps.alertAccess as Record<string, jest.Mock>;
    alertAccess.claimEscalatable.mockResolvedValue([criticalAlert()]);
    alertAccess.listNotificationsForAlert.mockResolvedValue([
      { id: 'n-1', recipientAccountId: 'acc-fam', alertId: 'alert-1', read: false },
    ]);

    const result = await manager.sweepAlertEscalation(15);

    expect(result).toEqual({ escalated: 1 });
    // El umbral define el corte del claim: alertas más viejas que now-15min.
    const cutoff = alertAccess.claimEscalatable.mock.calls[0][0] as Date;
    expect(Math.abs(cutoff.getTime() - (Date.now() - 15 * 60_000))).toBeLessThan(5_000);
    // Re-notifica POR PUSH: la campana original sigue sin leer, jamás se duplica (unique NFR-27).
    expect(alertAccess.createNotification).not.toHaveBeenCalled();
    expect((deps.pushTransport as { deliver: jest.Mock }).deliver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'alert', title: '⚠️ Alerta crítica sin atender' }),
    );
    // Outcome del reintento por destinatario, marcado como escalación (NFR-26).
    expect(alertAccess.recordDeliveryOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'n-1',
        channel: 'push',
        status: 'delivered',
        detail: expect.stringContaining('escalación'),
      }),
    );
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'care-record.alert.escalated', target: { type: 'alert', id: 'alert-1' } }),
    );
  });

  it('Dado que no hay críticas vencidas sin acuse, cuando barre, entonces no pushea nada', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.sweepAlertEscalation(15);

    expect(result).toEqual({ escalated: 0 });
    expect((deps.pushTransport as { deliver: jest.Mock }).deliver).not.toHaveBeenCalled();
  });

  it('Dada una alerta reclamada sin notificaciones (círculo vacío al crearla), cuando barre, entonces la saltea sin escalar', async () => {
    const { manager, deps } = makeManager();
    const alertAccess = deps.alertAccess as Record<string, jest.Mock>;
    alertAccess.claimEscalatable.mockResolvedValue([criticalAlert()]);
    alertAccess.listNotificationsForAlert.mockResolvedValue([]);

    const result = await manager.sweepAlertEscalation(15);

    expect(result).toEqual({ escalated: 0 });
    expect((deps.pushTransport as { deliver: jest.Mock }).deliver).not.toHaveBeenCalled();
  });

  it('El age-out vive en el claim: el barrido escala EXACTAMENTE lo que claimEscalatable reclamó (superseded/acusadas quedan afuera en SQL)', async () => {
    const { manager, deps } = makeManager();
    const alertAccess = deps.alertAccess as Record<string, jest.Mock>;
    alertAccess.claimEscalatable.mockResolvedValue([
      criticalAlert({ id: 'alert-1' }),
      criticalAlert({ id: 'alert-2', metricKey: 'temperature' }),
    ]);
    alertAccess.listNotificationsForAlert.mockResolvedValue([
      { id: 'n-1', recipientAccountId: 'acc-fam', read: false },
    ]);

    const result = await manager.sweepAlertEscalation(15);

    expect(result).toEqual({ escalated: 2 });
    expect((deps.pushTransport as { deliver: jest.Mock }).deliver).toHaveBeenCalledTimes(2);
  });
});
