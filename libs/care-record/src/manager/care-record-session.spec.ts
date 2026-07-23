import { CareRecordManager } from './care-record.manager';

/**
 * KER-38 · Higiene de push al logout (NFR-41): el worker despacha `membership.session.revoked`
 * y CareRecord (dueño único de las suscripciones) revoca cuenta+device — o toda la cuenta si
 * el device no viene identificado.
 */

function makeManager(pushSubscriptions: Record<string, jest.Mock>) {
  const stub = {} as never;
  return new CareRecordManager(
    stub, // tx
    stub, // careRecordAccess
    stub, // quarantineAccess
    stub, // rangeAccess
    stub, // alertAccess
    stub, // alertEngine
    stub, // accountAccess
    stub, // permission
    stub, // audit
    pushSubscriptions as never,
    stub, // pushTransport
  );
}

describe('handleSessionRevoked (NFR-41)', () => {
  it('Dado un logout con device identificado, entonces revoca SOLO esa suscripción (cuenta+endpoint)', async () => {
    const pushSubscriptions = {
      removeByEndpoint: jest.fn().mockResolvedValue(1),
      removeForAccount: jest.fn(),
    };
    const manager = makeManager(pushSubscriptions);
    await expect(
      manager.handleSessionRevoked({ accountId: 'acc-1', pushEndpoint: 'https://push.example/ep' }),
    ).resolves.toBe(1);
    expect(pushSubscriptions.removeByEndpoint).toHaveBeenCalledWith('acc-1', 'https://push.example/ep');
    expect(pushSubscriptions.removeForAccount).not.toHaveBeenCalled();
  });

  it('Dado un logout sin device, entonces revoca TODAS las suscripciones de la cuenta (higiene > comodidad)', async () => {
    const pushSubscriptions = {
      removeByEndpoint: jest.fn(),
      removeForAccount: jest.fn().mockResolvedValue(2),
    };
    const manager = makeManager(pushSubscriptions);
    await expect(manager.handleSessionRevoked({ accountId: 'acc-1', pushEndpoint: null })).resolves.toBe(2);
    expect(pushSubscriptions.removeForAccount).toHaveBeenCalledWith('acc-1');
  });
});
