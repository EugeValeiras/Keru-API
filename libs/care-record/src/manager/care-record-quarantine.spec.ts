import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthPrincipal } from '@keru/core';
import { CareRecordManager } from './care-record.manager';
import { QuarantinedRecord } from '../resource-access/entities/quarantined-record.entity';
import { ClinicalRecord } from '../resource-access/entities/clinical-record.entity';
import { RecordVitalsDto, RecordNoteDto } from './dto/record.dto';

/**
 * UC-12 A3 · Cuarentena de llegadas tardías no autorizadas (NFR-30): "se ponen en cuarentena,
 * nunca se descartan en silencio". El círculo ve y resuelve (consent-holder/manager) con
 * auditoría; un registro aprobado entra al historial con su measuredAt original (NFR-36).
 */

const caregiver: AuthPrincipal = { accountId: 'acc-cg', email: 'cg@keru.test', role: 'caregiver' };
const familiar: AuthPrincipal = { accountId: 'acc-fam', email: 'fam@keru.test', role: 'family' };

const MEASURED_AT = new Date('2026-07-20T22:30:00Z');

const vitalsDto = (over: Partial<RecordVitalsDto> = {}): RecordVitalsDto =>
  ({
    operationId: 'op-1',
    measuredAt: MEASURED_AT.toISOString(),
    values: [{ metricKey: 'heart-rate', value: 80 }],
    ...over,
  }) as RecordVitalsDto;

const quarantined = (over: Partial<QuarantinedRecord> = {}): QuarantinedRecord =>
  ({
    id: 'q-1',
    patientId: 'pat-1',
    type: 'vitals',
    authorAccountId: 'acc-cg',
    authorRole: 'caregiver',
    measuredAt: MEASURED_AT,
    data: { values: [{ metricKey: 'heart-rate', value: 80 }] },
    reason: 'no-authority-at-measurement',
    status: 'pending',
    resolvedByAccountId: null,
    resolvedAt: null,
    approvedRecordId: null,
    createdByOperationId: 'op-1',
    receivedAt: new Date('2026-07-22T10:00:00Z'),
    ...over,
  }) as QuarantinedRecord;

const clinical = (over: Partial<ClinicalRecord> = {}): ClinicalRecord =>
  ({
    id: 'rec-1',
    patientId: 'pat-1',
    type: 'vitals',
    authorAccountId: 'acc-cg',
    authorRole: 'caregiver',
    measuredAt: MEASURED_AT,
    data: { values: [{ metricKey: 'heart-rate', value: 80 }] },
    createdByOperationId: 'op-1',
    recordedAt: new Date(),
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
      quarantine: jest.fn().mockResolvedValue(quarantined()),
      findById: jest.fn().mockResolvedValue(quarantined()),
      findByOperationId: jest.fn().mockResolvedValue(null),
      listForPatient: jest.fn().mockResolvedValue([quarantined()]),
      resolve: jest.fn().mockResolvedValue(undefined),
    },
    rangeAccess: {
      getPlausible: jest.fn().mockReturnValue({ min: 0, max: 400, unit: 'bpm' }),
      getApplicableRange: jest
        .fn()
        .mockResolvedValue({ metricKey: 'heart-rate', min: 50, max: 110, unit: 'bpm', version: 'rv-1' }),
    },
    alertAccess: {
      createAlert: jest.fn().mockResolvedValue({ id: 'alert-1' }),
      createNotification: jest.fn().mockResolvedValue(undefined),
    },
    alertEngine: { evaluateVital: jest.fn().mockReturnValue({ outOfRange: false }) },
    accountAccess: {
      listLinksForPatient: jest.fn().mockResolvedValue([
        { accountId: 'acc-fam', role: 'consent-holder' },
        { accountId: 'acc-fam-2', role: 'viewer' },
      ]),
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', birthDate: '1948-03-15' }),
    },
    permission: {
      classifyClinicalWrite: jest.fn().mockResolvedValue('authorized'),
      assertLinked: jest.fn().mockResolvedValue(undefined),
      hasLinkRole: jest.fn().mockResolvedValue(true),
    },
    audit: { record: jest.fn() },
    pushSubscriptions: {
      listForAccounts: jest.fn().mockResolvedValue([]),
      removeStaleEndpoints: jest.fn().mockResolvedValue(undefined),
    },
    pushTransport: {
      getPublicKey: jest.fn().mockReturnValue(null),
      deliver: jest.fn().mockResolvedValue([]),
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

describe('NFR-30 · llegada tardía no autorizada queda en cuarentena', () => {
  it('Dado un cuidador con relación pero sin ventana que cubra measuredAt, cuando registra vitales, entonces queda en cuarentena (no 403), se notifica al círculo y se audita', async () => {
    const { manager, deps } = makeManager();
    (deps.permission as { classifyClinicalWrite: jest.Mock }).classifyClinicalWrite.mockResolvedValue('quarantine');

    const result = await manager.recordVitals('pat-1', vitalsDto(), caregiver);

    expect(result.outcome).toBe('quarantined');
    const qa = deps.quarantineAccess as { quarantine: jest.Mock };
    expect(qa.quarantine).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'pat-1', type: 'vitals', authorAccountId: 'acc-cg', measuredAt: MEASURED_AT }),
      'op-1',
      expect.anything(),
    );
    // No entra al historial clínico hasta ser aprobado.
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
    // Nunca en silencio: campana al círculo + auditoría.
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quarantine', recipientAccountId: 'acc-fam' }),
      expect.anything(),
    );
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'care-record.quarantined', actor: 'acc-cg' }),
    );
  });

  it('Dada una novedad tardía no autorizada, cuando se registra, entonces también entra en cuarentena (UC-20 A1)', async () => {
    const { manager, deps } = makeManager();
    (deps.permission as { classifyClinicalWrite: jest.Mock }).classifyClinicalWrite.mockResolvedValue('quarantine');
    (deps.quarantineAccess as { quarantine: jest.Mock }).quarantine.mockResolvedValue(
      quarantined({ type: 'note', data: { text: 'llegó tarde' } }),
    );

    const result = await manager.recordNote('pat-1', { operationId: 'op-2', measuredAt: MEASURED_AT.toISOString(), text: 'llegó tarde' } as RecordNoteDto, caregiver);

    expect(result.outcome).toBe('quarantined');
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dado alguien sin relación alguna con el paciente, cuando registra, entonces 403 y NO se pone en cuarentena', async () => {
    const { manager, deps } = makeManager();
    (deps.permission as { classifyClinicalWrite: jest.Mock }).classifyClinicalWrite.mockResolvedValue('forbidden');

    await expect(manager.recordVitals('pat-1', vitalsDto(), caregiver)).rejects.toThrow(ForbiddenException);
    expect((deps.quarantineAccess as { quarantine: jest.Mock }).quarantine).not.toHaveBeenCalled();
  });

  it('Dado un reintento con el mismo operationId de un item pendiente, cuando vuelve a llegar, entonces devuelve el mismo item sin re-notificar (NFR-34)', async () => {
    const { manager, deps } = makeManager();
    (deps.permission as { classifyClinicalWrite: jest.Mock }).classifyClinicalWrite.mockResolvedValue('quarantine');
    (deps.quarantineAccess as { findByOperationId: jest.Mock }).findByOperationId.mockResolvedValue(quarantined());

    const result = await manager.recordVitals('pat-1', vitalsDto(), caregiver);

    expect(result.outcome).toBe('quarantined');
    expect((deps.quarantineAccess as { quarantine: jest.Mock }).quarantine).not.toHaveBeenCalled();
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).not.toHaveBeenCalled();
  });
});

describe('UC-12 A3 · el círculo ve y resuelve la cuarentena', () => {
  it('Dado un vinculado, cuando lista la cuarentena, entonces ve los items del paciente', async () => {
    const { manager, deps } = makeManager();

    const items = await manager.listQuarantineForPatient('pat-1', familiar);

    expect((deps.permission as { assertLinked: jest.Mock }).assertLinked).toHaveBeenCalledWith({
      accountId: 'acc-fam',
      patientId: 'pat-1',
    });
    expect(items).toHaveLength(1);
  });

  it('Dado un consent-holder/manager, cuando aprueba, entonces el registro entra al historial con su measuredAt y autor ORIGINALES (NFR-36) y queda auditado', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.approveQuarantined('pat-1', 'q-1', familiar);

    const record = (deps.careRecordAccess as { record: jest.Mock }).record;
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat-1',
        type: 'vitals',
        measuredAt: MEASURED_AT, // measuredAt original, no el de aprobación (NFR-36)
        authorAccountId: 'acc-cg', // autor original, no quien aprueba
        authorRole: 'caregiver',
      }),
      'op-1', // misma identidad de operación: el flujo es idempotente extremo a extremo
      expect.anything(),
    );
    expect((deps.quarantineAccess as { resolve: jest.Mock }).resolve).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ status: 'approved', resolvedByAccountId: 'acc-fam', approvedRecordId: 'rec-1' }),
      expect.anything(),
    );
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'care-record.quarantine.approved', actor: 'acc-fam' }),
    );
    expect(result.status).toBe('approved');
  });

  it('Dado un vitals aprobado con valor fuera de rango, cuando entra al historial, entonces se evalúan las alertas como en cualquier ingreso (UC-12 A2)', async () => {
    const { manager, deps } = makeManager();
    (deps.alertEngine as { evaluateVital: jest.Mock }).evaluateVital.mockReturnValue({
      outOfRange: true,
      severity: 'high',
      message: 'Frecuencia fuera de rango',
    });

    await manager.approveQuarantined('pat-1', 'q-1', familiar);

    expect((deps.alertAccess as { createAlert: jest.Mock }).createAlert).toHaveBeenCalled();
  });

  it('Dado un viewer (sin rol de resolución), cuando intenta aprobar, entonces 403', async () => {
    const { manager, deps } = makeManager();
    (deps.permission as { hasLinkRole: jest.Mock }).hasLinkRole.mockResolvedValue(false);

    await expect(manager.approveQuarantined('pat-1', 'q-1', familiar)).rejects.toThrow(ForbiddenException);
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dado un item ya aprobado, cuando se re-aprueba, entonces es no-op idempotente (no duplica el registro)', async () => {
    const { manager, deps } = makeManager();
    (deps.quarantineAccess as { findById: jest.Mock }).findById.mockResolvedValue(
      quarantined({ status: 'approved', approvedRecordId: 'rec-1' }),
    );

    const result = await manager.approveQuarantined('pat-1', 'q-1', familiar);

    expect(result.status).toBe('approved');
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
    expect((deps.quarantineAccess as { resolve: jest.Mock }).resolve).not.toHaveBeenCalled();
  });

  it('Dado un item ya descartado, cuando se intenta aprobar, entonces 400', async () => {
    const { manager, deps } = makeManager();
    (deps.quarantineAccess as { findById: jest.Mock }).findById.mockResolvedValue(quarantined({ status: 'discarded' }));

    await expect(manager.approveQuarantined('pat-1', 'q-1', familiar)).rejects.toThrow(BadRequestException);
  });

  it('Dado un consent-holder/manager, cuando descarta, entonces el item queda marcado (nunca se borra) y auditado, sin entrar al historial', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.discardQuarantined('pat-1', 'q-1', familiar);

    expect((deps.quarantineAccess as { resolve: jest.Mock }).resolve).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({ status: 'discarded', resolvedByAccountId: 'acc-fam' }),
      expect.anything(),
    );
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'care-record.quarantine.discarded', actor: 'acc-fam' }),
    );
    expect(result.status).toBe('discarded');
  });
});
