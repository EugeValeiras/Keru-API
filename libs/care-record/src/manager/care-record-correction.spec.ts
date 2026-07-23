import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthPrincipal } from '@keru/core';
import { CareRecordManager } from './care-record.manager';
import { ClinicalRecord } from '../resource-access/entities/clinical-record.entity';
import { QuarantinedRecord } from '../resource-access/entities/quarantined-record.entity';
import { CorrectRecordDto } from './dto/record.dto';

/**
 * KER-36 · Corrección de registros con traza y re-evaluación (NFR-38, I2): un registro nunca se
 * edita — la corrección es un registro NUEVO append-only con referencia, autor y razón; el
 * original queda intacto y marcado superseded. Corregir resuelve-por-corrección las alertas
 * abiertas del original (campana al círculo) y re-evalúa el valor corregido (puede alertar de
 * nuevo contra la versión nueva). Misma autoridad y cuarentena que el alta (NFR-30).
 */

const familiar: AuthPrincipal = { accountId: 'acc-fam', email: 'fam@keru.test', role: 'family' };

const MEASURED_AT = new Date('2026-07-20T22:30:00Z');

const original = (over: Partial<ClinicalRecord> = {}): ClinicalRecord =>
  ({
    id: 'rec-1',
    patientId: 'pat-1',
    type: 'vitals',
    authorAccountId: 'acc-fam',
    authorRole: 'family',
    measuredAt: MEASURED_AT,
    data: { values: [{ metricKey: 'temperature', value: 39.8 }] },
    createdByOperationId: 'op-alta',
    supersedesRecordId: null,
    correctionReason: null,
    supersededAt: null,
    supersededByRecordId: null,
    recordedAt: new Date(),
    ...over,
  }) as ClinicalRecord;

const correction = (over: Partial<ClinicalRecord> = {}): ClinicalRecord =>
  original({
    id: 'rec-2',
    data: { values: [{ metricKey: 'temperature', value: 36.8 }] },
    createdByOperationId: 'op-fix',
    supersedesRecordId: 'rec-1',
    correctionReason: 'Error de tipeo',
    ...over,
  });

const correctDto = (over: Partial<CorrectRecordDto> = {}): CorrectRecordDto =>
  ({
    operationId: 'op-fix',
    reason: 'Error de tipeo',
    values: [{ metricKey: 'temperature', value: 36.8 }],
    ...over,
  }) as CorrectRecordDto;

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    careRecordAccess: {
      findById: jest.fn().mockResolvedValue(original()),
      findByOperationId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(correction()),
      markSuperseded: jest.fn().mockResolvedValue(true),
    },
    quarantineAccess: {
      quarantine: jest.fn(async (input: Record<string, unknown>) => ({ id: 'q-1', ...input }) as QuarantinedRecord),
      findById: jest.fn().mockResolvedValue(null),
      findByOperationId: jest.fn().mockResolvedValue(null),
      resolve: jest.fn().mockResolvedValue(undefined),
    },
    rangeAccess: {
      getPlausible: jest.fn().mockReturnValue({ min: 30, max: 45, unit: '°C' }),
      getApplicableRange: jest
        .fn()
        .mockResolvedValue({ metricKey: 'temperature', min: 36, max: 37.5, unit: '°C', version: 'rv-1' }),
    },
    alertAccess: {
      createAlert: jest.fn().mockResolvedValue({ id: 'alert-2' }),
      createNotification: jest.fn(async (input: { recipientAccountId: string }) => ({
        id: `n-${input.recipientAccountId}`,
      })),
      supersedePriorUnacked: jest.fn().mockResolvedValue(0),
      resolveByCorrection: jest.fn().mockResolvedValue([]),
      recordDeliveryOutcome: jest.fn().mockResolvedValue(undefined),
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

describe('NFR-38 · la corrección es un registro nuevo con traza; el original queda superseded', () => {
  it('Dado un vitals vigente, cuando se corrige, entonces se crea un registro nuevo con supersedesRecordId + razón, el original se marca superseded y se audita', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar);

    expect(result.outcome).toBe('recorded');
    const record = (deps.careRecordAccess as { record: jest.Mock }).record;
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat-1',
        type: 'vitals',
        supersedesRecordId: 'rec-1',
        correctionReason: 'Error de tipeo',
        measuredAt: MEASURED_AT, // sin measuredAt en el DTO, conserva el del original (NFR-36)
        authorAccountId: 'acc-fam',
      }),
      'op-fix',
      expect.anything(),
    );
    expect((deps.careRecordAccess as { markSuperseded: jest.Mock }).markSuperseded).toHaveBeenCalledWith(
      'rec-1',
      'rec-2',
      expect.anything(),
    );
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'care-record.corrected',
        actor: 'acc-fam',
        metadata: expect.objectContaining({ supersedesRecordId: 'rec-1', reason: 'Error de tipeo' }),
      }),
    );
  });

  it('Dado un registro ya corregido (superseded), cuando se lo intenta corregir, entonces 409: la corrección va sobre la versión vigente', async () => {
    const { manager, deps } = makeManager();
    (deps.careRecordAccess as { findById: jest.Mock }).findById.mockResolvedValue(
      original({ supersededAt: new Date(), supersededByRecordId: 'rec-2' }),
    );

    await expect(manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar)).rejects.toThrow(ConflictException);
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dada una corrección concurrente (el guard de markSuperseded pierde la carrera), entonces 409 y la transacción no completa', async () => {
    const { manager, deps } = makeManager();
    (deps.careRecordAccess as { markSuperseded: jest.Mock }).markSuperseded.mockResolvedValue(false);

    await expect(manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar)).rejects.toThrow(ConflictException);
  });

  it('Dado un registro de otro paciente, cuando se corrige, entonces 404', async () => {
    const { manager } = makeManager();

    await expect(manager.correctRecord('pat-OTRO', 'rec-1', correctDto(), familiar)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('Dado un reintento con el mismo operationId, entonces devuelve la corrección ya hecha sin re-corregir (NFR-34)', async () => {
    const { manager, deps } = makeManager();
    (deps.careRecordAccess as { findByOperationId: jest.Mock }).findByOperationId.mockResolvedValue(correction());

    const result = await manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar);

    expect(result.outcome).toBe('recorded');
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
    expect((deps.careRecordAccess as { markSuperseded: jest.Mock }).markSuperseded).not.toHaveBeenCalled();
  });

  it('Dado un contenido que no corresponde al type del original (text para un vitals), entonces 400', async () => {
    const { manager } = makeManager();

    await expect(
      manager.correctRecord('pat-1', 'rec-1', correctDto({ values: undefined, text: 'no va' }), familiar),
    ).rejects.toThrow(BadRequestException);
  });

  it('Dado un valor corregido implausible (A1), entonces 422 — la corrección tampoco acepta errores de tipeo', async () => {
    const { manager } = makeManager();

    await expect(
      manager.correctRecord('pat-1', 'rec-1', correctDto({ values: [{ metricKey: 'temperature', value: 98 }] }), familiar),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});

describe('NFR-38 · re-evaluación: alerta previa resuelta-por-corrección + alerta nueva si corresponde', () => {
  it('Dada una alerta abierta del original, cuando se corrige, entonces queda resuelta-por-corrección y el círculo recibe la campana de resolución', async () => {
    const { manager, deps } = makeManager();
    (deps.alertAccess as { resolveByCorrection: jest.Mock }).resolveByCorrection.mockResolvedValue([
      { id: 'alert-1', message: 'Temperatura fuera de rango: 39.8 °C' },
    ]);

    await manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar);

    expect((deps.alertAccess as { resolveByCorrection: jest.Mock }).resolveByCorrection).toHaveBeenCalledWith(
      'rec-1',
      'rec-2',
      expect.anything(),
    );
    // Campana de resolución a TODO el círculo, separada de la campana original de la alerta.
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'alert-resolved',
        alertId: null,
        title: 'Alerta resuelta por corrección',
        recipientAccountId: 'acc-fam',
      }),
      expect.anything(),
    );
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alert-resolved', recipientAccountId: 'acc-fam-2' }),
      expect.anything(),
    );
  });

  it('Dado un valor corregido fuera de rango, cuando se corrige, entonces dispara una alerta NUEVA que referencia la versión nueva del registro', async () => {
    const { manager, deps } = makeManager();
    (deps.alertEngine as { evaluateVital: jest.Mock }).evaluateVital.mockReturnValue({
      outOfRange: true,
      severity: 'critical',
      message: 'Temperatura fuera de rango',
    });

    await manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar);

    expect((deps.alertAccess as { createAlert: jest.Mock }).createAlert).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'rec-2', rangeVersion: 'rv-1' }),
      expect.anything(),
    );
  });

  it('Dado un valor corregido dentro de rango, entonces NO se crea alerta nueva', async () => {
    const { manager, deps } = makeManager();

    await manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar);

    expect((deps.alertAccess as { createAlert: jest.Mock }).createAlert).not.toHaveBeenCalled();
  });
});

describe('NFR-30 · misma autoridad y cuarentena que el alta', () => {
  it('Dado alguien sin relación alguna, cuando corrige, entonces 403 (mismo PermissionEngine que el alta)', async () => {
    const { manager, deps } = makeManager();
    (deps.permission as { classifyClinicalWrite: jest.Mock }).classifyClinicalWrite.mockResolvedValue('forbidden');

    await expect(manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar)).rejects.toThrow();
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dada una corrección tardía no autorizada, entonces va a cuarentena con su traza de corrección — no se aplica todavía', async () => {
    const { manager, deps } = makeManager();
    (deps.permission as { classifyClinicalWrite: jest.Mock }).classifyClinicalWrite.mockResolvedValue('quarantine');

    const result = await manager.correctRecord('pat-1', 'rec-1', correctDto(), familiar);

    expect(result.outcome).toBe('quarantined');
    expect((deps.quarantineAccess as { quarantine: jest.Mock }).quarantine).toHaveBeenCalledWith(
      expect.objectContaining({ supersedesRecordId: 'rec-1', correctionReason: 'Error de tipeo' }),
      'op-fix',
      expect.anything(),
    );
    expect((deps.careRecordAccess as { record: jest.Mock }).record).not.toHaveBeenCalled();
    expect((deps.careRecordAccess as { markSuperseded: jest.Mock }).markSuperseded).not.toHaveBeenCalled();
  });

  it('Dado un item de cuarentena que es una corrección, cuando el círculo lo aprueba, entonces se APLICA la corrección (original superseded + alertas resueltas + re-evaluación)', async () => {
    const { manager, deps } = makeManager();
    (deps.quarantineAccess as { findById: jest.Mock }).findById.mockResolvedValue({
      id: 'q-1',
      patientId: 'pat-1',
      type: 'vitals',
      authorAccountId: 'acc-fam',
      authorRole: 'family',
      measuredAt: MEASURED_AT,
      data: { values: [{ metricKey: 'temperature', value: 36.8 }] },
      status: 'pending',
      reason: 'no-authority-at-measurement',
      resolvedByAccountId: null,
      resolvedAt: null,
      approvedRecordId: null,
      supersedesRecordId: 'rec-1',
      correctionReason: 'Error de tipeo',
      createdByOperationId: 'op-fix',
      receivedAt: new Date(),
    } as QuarantinedRecord);

    const result = await manager.approveQuarantined('pat-1', 'q-1', familiar);

    expect(result.status).toBe('approved');
    expect((deps.careRecordAccess as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ supersedesRecordId: 'rec-1', correctionReason: 'Error de tipeo' }),
      'op-fix',
      expect.anything(),
    );
    expect((deps.careRecordAccess as { markSuperseded: jest.Mock }).markSuperseded).toHaveBeenCalledWith(
      'rec-1',
      'rec-2',
      expect.anything(),
    );
    expect((deps.alertAccess as { resolveByCorrection: jest.Mock }).resolveByCorrection).toHaveBeenCalled();
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'care-record.quarantine.approved' }),
    );
  });
});
