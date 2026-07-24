import { BadRequestException } from '@nestjs/common';
import { MembershipManager } from './membership.manager';
import { AddCertificationDto } from './dto/certification-io.dto';

/**
 * KER-52 (UC-02/UC-19) · Lógica por-certificación del manager: aprobar/rechazar setea el estado
 * por-cert, recalcula la insignia agregada `certificaciones` (derivada: ≥1 aprobada), y solo una
 * cert pendiente puede revisarse; agregar valida contra el catálogo finito.
 */

const cert = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  catalogKey: 'nursing-degree',
  institution: 'UBA',
  year: 2015,
  documentKey: 'private/documents/x.pdf',
  documentContentType: 'application/pdf',
  status: 'pending',
  verified: false,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  ...over,
});

const caregiver = (over: Record<string, unknown> = {}) => ({
  id: 'cg-1',
  accountId: 'acc-cg',
  status: 'approved',
  certifications: [cert()],
  badges: { certifications: false, identity: true, background: false },
  ...over,
});

function makeManager(cg: Record<string, unknown> = caregiver()) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {},
    caregiverAccess: {
      findById: jest.fn().mockResolvedValue(cg),
      findByAccountId: jest.fn().mockResolvedValue(cg),
      setCertifications: jest.fn().mockResolvedValue(undefined),
      setBadges: jest.fn().mockResolvedValue(undefined),
      addCertification: jest.fn().mockResolvedValue(undefined),
    },
    catalogAccess: { list: jest.fn().mockResolvedValue([]) },
    jwt: {},
    pubsub: {},
    audit: { record: jest.fn() },
    email: {},
    files: {},
    tokenRevocation: {},
    config: { get: jest.fn((_k: string, d?: unknown) => d) },
    permission: {},
  };
  const manager = new MembershipManager(
    deps.tx as never,
    deps.accountAccess as never,
    deps.caregiverAccess as never,
    deps.catalogAccess as never,
    deps.jwt as never,
    deps.pubsub as never,
    deps.audit as never,
    deps.email as never,
    deps.files as never,
    deps.tokenRevocation as never,
    deps.config as never,
    deps.permission as never,
  );
  return { manager, deps };
}

describe('KER-52 · aprobación por-certificación (UC-19)', () => {
  it('Dado una cert pendiente, cuando el admin la aprueba, entonces queda verificada y la insignia agregada se deriva true', async () => {
    const { manager, deps } = makeManager();

    await manager.approveCertification('cg-1', 'c1', 'admin-1');

    expect(deps.caregiverAccess.setCertifications).toHaveBeenCalledWith(
      'cg-1',
      [expect.objectContaining({ id: 'c1', status: 'approved', verified: true, reviewedBy: 'admin-1' })],
      expect.anything(),
    );
    // insignia agregada derivada (≥1 aprobada); identidad se preserva, antecedentes no.
    expect(deps.caregiverAccess.setBadges).toHaveBeenCalledWith(
      'cg-1',
      { certifications: true, identity: true, background: false },
      expect.anything(),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'membership.caregiver.certification-approved' }),
    );
  });

  it('Dado una cert pendiente, cuando el admin la rechaza con motivo, entonces queda rechazada y la insignia agregada sigue false', async () => {
    const { manager, deps } = makeManager();

    await manager.rejectCertification('cg-1', 'c1', 'admin-1', 'Documento ilegible');

    expect(deps.caregiverAccess.setCertifications).toHaveBeenCalledWith(
      'cg-1',
      [expect.objectContaining({ status: 'rejected', verified: false, rejectionReason: 'Documento ilegible' })],
      expect.anything(),
    );
    expect(deps.caregiverAccess.setBadges).toHaveBeenCalledWith(
      'cg-1',
      { certifications: false, identity: true, background: false },
      expect.anything(),
    );
  });

  it('Dado una cert YA aprobada, cuando se intenta re-aprobar, entonces 400 (inmutable, §7)', async () => {
    const { manager, deps } = makeManager(caregiver({ certifications: [cert({ status: 'approved' })] }));

    await expect(manager.approveCertification('cg-1', 'c1', 'admin-1')).rejects.toThrow(BadRequestException);
    expect(deps.caregiverAccess.setCertifications).not.toHaveBeenCalled();
  });

  it('Dado un certId inexistente, cuando el admin aprueba, entonces 404', async () => {
    const { manager } = makeManager();
    await expect(manager.approveCertification('cg-1', 'no-existe', 'admin-1')).rejects.toThrow();
  });
});

describe('KER-52 · agregar certificación (UC-02 A4)', () => {
  const addDto = (over: Partial<AddCertificationDto> = {}): AddCertificationDto =>
    ({
      operationId: 'op-add-1',
      catalogKey: 'cpr',
      institution: 'SAME',
      year: 2022,
      documentKey: 'private/documents/y.pdf',
      documentContentType: 'application/pdf',
      ...over,
    }) as AddCertificationDto;

  it('Dado un tipo del catálogo, cuando agrega una cert, entonces se agrega pending/oculta e idempotente por operationId', async () => {
    const { manager, deps } = makeManager();

    await manager.addCertification(addDto(), 'acc-cg');

    expect(deps.caregiverAccess.addCertification).toHaveBeenCalledWith(
      'cg-1',
      expect.objectContaining({ catalogKey: 'cpr', status: 'pending', verified: false, operationId: 'op-add-1' }),
      'op-add-1',
    );
  });

  it('Dado un tipo FUERA del catálogo, cuando agrega una cert, entonces 400 y no se escribe', async () => {
    const { manager, deps } = makeManager();

    await expect(manager.addCertification(addDto({ catalogKey: 'no-existe' }), 'acc-cg')).rejects.toThrow(
      BadRequestException,
    );
    expect(deps.caregiverAccess.addCertification).not.toHaveBeenCalled();
  });
});
