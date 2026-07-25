import { CareRecordManager } from './care-record.manager';
import { Notification } from '../resource-access/entities/notification.entity';

/**
 * KER-86 (UC-18) · La campana pagina con cursor descendente por createdAt. El manager acota con un
 * default sano, pide una fila extra para saber si hay más sin un COUNT, y emite un `nextCursor`
 * opaco (base64url de `createdAt|id`) que la página siguiente reenvía. Un cursor ilegible se ignora.
 */

const notif = (id: string, createdAt: string): Notification =>
  ({ id, recipientAccountId: 'acc-1', createdAt: new Date(createdAt) }) as Notification;

function makeManager(listForAccount: jest.Mock) {
  const alertAccess = { listForAccount };
  const manager = new CareRecordManager(
    {} as never, // tx
    {} as never, // careRecordAccess
    {} as never, // quarantineAccess
    {} as never, // rangeAccess
    alertAccess as never,
    {} as never, // alertEngine
    {} as never, // accountAccess
    {} as never, // permission
    {} as never, // audit
    {} as never, // pushSubscriptions
    {} as never, // pushTransport
  );
  return { manager, listForAccount };
}

const decodeCursor = (cursor: string): { iso: string; id: string } => {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  return { iso, id };
};

describe('KER-86 · paginación de la campana (cursor DESC por createdAt)', () => {
  it('Dado ningún parámetro, entonces pide el default (20) + 1 fila extra, sin cursor', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const { manager } = makeManager(list);

    await manager.listNotifications('acc-1');

    expect(list).toHaveBeenCalledWith('acc-1', { limit: 21, cursor: null });
  });

  it('Dado que caben todas en la página, entonces nextCursor es null y no se descarta ninguna', async () => {
    const rows = [notif('a', '2026-07-24T10:00:00Z'), notif('b', '2026-07-24T09:00:00Z')];
    const { manager } = makeManager(jest.fn().mockResolvedValue(rows));

    const page = await manager.listNotifications('acc-1', { limit: 20 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('Dado que hay más, entonces recorta al límite y el nextCursor apunta al último ítem devuelto', async () => {
    // Pide limit=2 → el access trae 3 (limit+1). El 3º solo señala "hay más".
    const rows = [
      notif('a', '2026-07-24T10:00:00Z'),
      notif('b', '2026-07-24T09:00:00Z'),
      notif('c', '2026-07-24T08:00:00Z'),
    ];
    const { manager, listForAccount } = makeManager(jest.fn().mockResolvedValue(rows));

    const page = await manager.listNotifications('acc-1', { limit: 2 });

    expect(listForAccount).toHaveBeenCalledWith('acc-1', { limit: 3, cursor: null });
    expect(page.items.map((n) => n.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).not.toBeNull();
    // El cursor codifica el último ítem entregado ('b'), no el centinela 'c'.
    const decoded = decodeCursor(page.nextCursor as string);
    expect(decoded.id).toBe('b');
    expect(decoded.iso).toBe(new Date('2026-07-24T09:00:00Z').toISOString());
  });

  it('Dado un limit por encima del tope, entonces lo acota a 100 (+1)', async () => {
    const { manager, listForAccount } = makeManager(jest.fn().mockResolvedValue([]));

    await manager.listNotifications('acc-1', { limit: 1000 });

    expect(listForAccount).toHaveBeenCalledWith('acc-1', { limit: 101, cursor: null });
  });

  it('Dado un cursor válido, entonces lo decodifica y lo pasa al access', async () => {
    const cursor = Buffer.from('2026-07-24T09:00:00.000Z|b', 'utf8').toString('base64url');
    const { manager, listForAccount } = makeManager(jest.fn().mockResolvedValue([]));

    await manager.listNotifications('acc-1', { limit: 2, cursor });

    expect(listForAccount).toHaveBeenCalledWith('acc-1', {
      limit: 3,
      cursor: { createdAt: new Date('2026-07-24T09:00:00.000Z'), id: 'b' },
    });
  });

  it('Dado un cursor ilegible, entonces lo ignora (primera página)', async () => {
    const { manager, listForAccount } = makeManager(jest.fn().mockResolvedValue([]));

    await manager.listNotifications('acc-1', { limit: 2, cursor: 'no-es-un-cursor' });

    expect(listForAccount).toHaveBeenCalledWith('acc-1', { limit: 3, cursor: null });
  });
});
