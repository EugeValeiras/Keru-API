import { BadRequestException } from '@nestjs/common';
import { ReputationManager } from './reputation.manager';
import { Review } from '../resource-access/entities/review.entity';

/**
 * NFR-20 (KER-31, Decouple row 49): la elegibilidad de reseña la da el servicio completado
 * (razón terminal `completed`); el honor-mark de pago no participa de la decisión.
 */

const hiringRequest = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  requesterAccountId: 'acc-fam',
  caregiverId: 'cg-1',
  patientId: 'pat-1',
  status: 'completed',
  terminalReason: 'completed',
  paidDeclaredAt: null,
  ...over,
});

const review = { id: 'rev-1', rating: 5, revealed: false } as unknown as Review;

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    reviewAccess: {
      findByRequestAndAuthor: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(review),
      create: jest.fn().mockResolvedValue(review),
      findCounterpart: jest.fn().mockResolvedValue(null),
      revealForRequest: jest.fn(),
    },
    hiringAccess: { findRequestById: jest.fn().mockResolvedValue(hiringRequest()) },
    caregiverAccess: { findByAccountId: jest.fn().mockResolvedValue({ id: 'cg-1' }) },
    audit: { record: jest.fn() },
    ...overrides,
  };
  const manager = new ReputationManager(
    deps.reviewAccess as never,
    deps.hiringAccess as never,
    deps.caregiverAccess as never,
    deps.audit as never,
  );
  return { manager, deps };
}

type ReviewAccessMock = { create: jest.Mock };
type HiringAccessMock = { findRequestById: jest.Mock };

describe('NFR-20 · elegibilidad de reseña basada en completado, no en el pago', () => {
  it('Dado un servicio no completado, cuando el solicitante reseña, entonces 400 y no se crea la reseña', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).findRequestById.mockResolvedValue(
      hiringRequest({ status: 'accepted', terminalReason: null }),
    );

    await expect(manager.reviewCaregiver('req-1', 'acc-fam', 5)).rejects.toThrow(BadRequestException);
    expect((deps.reviewAccess as ReviewAccessMock).create).not.toHaveBeenCalled();
  });

  it('Dado un cierre por cancelación (KER-32), cuando el solicitante reseña, entonces 400 — solo la razón terminal `completed` habilita', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).findRequestById.mockResolvedValue(
      hiringRequest({ status: 'completed', terminalReason: 'cancelled-by-caregiver' }),
    );

    await expect(manager.reviewCaregiver('req-1', 'acc-fam', 5)).rejects.toThrow(BadRequestException);
    expect((deps.reviewAccess as ReviewAccessMock).create).not.toHaveBeenCalled();
  });

  it('Dado un cierre por no-show (KER-32), cuando el cuidador reseña al paciente, entonces 400', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).findRequestById.mockResolvedValue(
      hiringRequest({ status: 'completed', terminalReason: 'no-show' }),
    );

    await expect(manager.reviewPatient('req-1', 'acc-cg', 4)).rejects.toThrow(BadRequestException);
    expect((deps.reviewAccess as ReviewAccessMock).create).not.toHaveBeenCalled();
  });

  it('Dado un servicio completado SIN pago declarado, cuando el solicitante reseña, entonces la reseña se acepta', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.reviewCaregiver('req-1', 'acc-fam', 5, 'Excelente');

    expect((deps.reviewAccess as ReviewAccessMock).create).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', subjectType: 'caregiver', subjectId: 'cg-1' }),
    );
    expect(result).toBe(review);
  });

  it('Dado un servicio completado CON pago declarado, cuando el solicitante reseña, entonces el resultado es el mismo (el pago no participa)', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).findRequestById.mockResolvedValue(
      hiringRequest({ paidDeclaredAt: new Date('2026-08-16T10:00:00Z') }),
    );

    const result = await manager.reviewCaregiver('req-1', 'acc-fam', 5);

    expect((deps.reviewAccess as ReviewAccessMock).create).toHaveBeenCalled();
    expect(result).toBe(review);
  });

  it('Dado un servicio completado, cuando el cuidador reseña al paciente (UC-21), entonces la reseña se acepta sin mirar el pago', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.reviewPatient('req-1', 'acc-cg', 4, 'Familia atenta');

    expect((deps.reviewAccess as ReviewAccessMock).create).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', subjectType: 'patient', subjectId: 'pat-1' }),
    );
    expect(result).toBe(review);
  });
});
