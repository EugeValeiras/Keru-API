import { EntityManager } from 'typeorm';
import { AlertAccess } from './alert.access';
import { Notification } from './entities/notification.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';

/**
 * KER-34 · AlertAccess: fan-out idempotente por constraint (NFR-27) + outcome de campana en la
 * misma transacción (NFR-26) + acuse con readAt (NFR-11). El unique parcial
 * (alertId, recipientAccountId) vive en la entidad/migración; acá se verifica que el verbo lo
 * aproveche: INSERT ... ON CONFLICT DO NOTHING y devolución de la fila existente en el conflicto.
 */

function makeInsertQb(executeResult: { raw: unknown[] }) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['insert', 'values', 'orIgnore', 'orUpdate', 'returning']) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue(executeResult);
  return qb;
}

function makeAccess(notifInsertResult: { raw: unknown[] } = { raw: [] }) {
  const notifQb = makeInsertQb(notifInsertResult);
  const deliveryQb = makeInsertQb({ raw: [] });

  const notifRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(notifQb),
    create: jest.fn((row: unknown) => row),
    save: jest.fn(async (row: { id?: string }) => ({ id: 'n-created', ...row })),
    findOneOrFail: jest.fn().mockResolvedValue({ id: 'n-existing', read: false }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const deliveryRepo = { createQueryBuilder: jest.fn().mockReturnValue(deliveryQb) };

  const em = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Notification) return notifRepo;
      if (entity === NotificationDelivery) return deliveryRepo;
      throw new Error('repo inesperado');
    }),
  } as unknown as EntityManager;

  const access = new AlertAccess(
    { createQueryBuilder: jest.fn() } as never,
    notifRepo as never,
    deliveryRepo as never,
  );
  return { access, em, notifRepo, deliveryRepo, notifQb, deliveryQb };
}

const alertInput = {
  recipientAccountId: 'acc-fam',
  patientId: 'pat-1',
  alertId: 'alert-1',
  type: 'alert',
  title: 'Alerta clínica',
  body: 'fuera de rango',
};

describe('KER-34 · fan-out idempotente por constraint (NFR-27)', () => {
  it('el fan-out de una alerta inserta con ON CONFLICT DO NOTHING (orIgnore) y devuelve la fila insertada', async () => {
    const { access, em, notifQb, notifRepo } = makeAccess({ raw: [{ id: 'n-1', read: false }] });

    const result = await access.createNotification(alertInput, em);

    expect(notifQb.orIgnore).toHaveBeenCalled();
    expect(result.id).toBe('n-1');
    expect(notifRepo.findOneOrFail).not.toHaveBeenCalled();
  });

  it('en el conflicto (retry / doble fan-out) NO duplica: devuelve la notificación ya existente', async () => {
    const { access, em, notifRepo } = makeAccess({ raw: [] });

    const result = await access.createNotification(alertInput, em);

    expect(result.id).toBe('n-existing');
    expect(notifRepo.findOneOrFail).toHaveBeenCalledWith({
      where: { alertId: 'alert-1', recipientAccountId: 'acc-fam' },
    });
    expect(notifRepo.save).not.toHaveBeenCalled();
  });

  it('una notificación SIN alerta (note/hiring/quarantine) inserta directo: puede repetirse por destinatario', async () => {
    const { access, em, notifRepo, notifQb } = makeAccess();

    await access.createNotification({ ...alertInput, alertId: null, type: 'note' }, em);

    expect(notifRepo.save).toHaveBeenCalled();
    expect(notifQb.orIgnore).not.toHaveBeenCalled();
  });
});

describe('KER-34 · outcome de entrega (NFR-26)', () => {
  it('la campana queda delivered al persistir la notificación, en la MISMA transacción', async () => {
    const { access, em, deliveryQb } = makeAccess({ raw: [{ id: 'n-1' }] });

    await access.createNotification(alertInput, em);

    expect(deliveryQb.values).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'n-1', channel: 'bell', status: 'delivered' }),
    );
  });

  it('recordDeliveryOutcome upserta por (notificación, canal): un reintento refresca el outcome, no duplica', async () => {
    const { access, deliveryQb } = makeAccess();

    await access.recordDeliveryOutcome({ notificationId: 'n-1', channel: 'push', status: 'failed', detail: '0/1 endpoints' });

    expect(deliveryQb.orUpdate).toHaveBeenCalledWith(['status', 'detail', 'recordedAt'], ['notificationId', 'channel']);
    expect(deliveryQb.values).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'n-1', channel: 'push', status: 'failed' }),
    );
  });
});

describe('KER-34 · acuse (NFR-11): leída = acusada, readAt fija el PRIMER read', () => {
  it('markRead marca solo si estaba no leída y sella readAt (re-marcar no mueve el acuse)', async () => {
    const { access, notifRepo } = makeAccess();

    await access.markRead('n-1', 'acc-fam');

    expect(notifRepo.update).toHaveBeenCalledWith(
      { id: 'n-1', recipientAccountId: 'acc-fam', read: false },
      expect.objectContaining({ read: true, readAt: expect.any(Date) }),
    );
  });

  it('markAllRead sella readAt en todas las no leídas y devuelve cuántas afectó', async () => {
    const { access, notifRepo } = makeAccess();

    const affected = await access.markAllRead('acc-fam');

    expect(affected).toBe(1);
    expect(notifRepo.update).toHaveBeenCalledWith(
      { recipientAccountId: 'acc-fam', read: false },
      expect.objectContaining({ read: true, readAt: expect.any(Date) }),
    );
  });
});
