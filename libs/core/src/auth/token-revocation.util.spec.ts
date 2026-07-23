import { TokenRevocationUtility } from './token-revocation.util';

/** KER-38 · Denylist de jti en Redis (NFR-41): TTL = vida restante, prefijo por entorno, fail-open. */

function makeUtil(client: Record<string, jest.Mock>) {
  const queue = { client: Promise.resolve(client) };
  const config = { get: jest.fn().mockReturnValue('keru-test') };
  return new TokenRevocationUtility(queue as never, config as never);
}

describe('TokenRevocationUtility (NFR-41)', () => {
  it('Dado un token vigente, cuando se revoca, entonces la clave lleva el prefijo del entorno y TTL = vida restante', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const util = makeUtil({ set, exists: jest.fn() });
    const exp = Math.floor(Date.now() / 1000) + 600; // vence en ~10 min
    await util.revoke('jti-1', exp);
    const [key, , px, ttlMs] = set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe('keru-test:jwt-denylist:jti-1');
    expect(px).toBe('PX');
    expect(ttlMs).toBeGreaterThan(590_000);
    expect(ttlMs).toBeLessThanOrEqual(600_000);
  });

  it('Dado un token ya expirado, cuando se revoca, entonces no se escribe nada (no hay qué revocar)', async () => {
    const set = jest.fn();
    const util = makeUtil({ set, exists: jest.fn() });
    await util.revoke('jti-1', Math.floor(Date.now() / 1000) - 10);
    expect(set).not.toHaveBeenCalled();
  });

  it('isRevoked responde según exista la clave; sin jti (token pre-KER-38) nunca está revocado', async () => {
    const exists = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const util = makeUtil({ set: jest.fn(), exists });
    await expect(util.isRevoked('jti-1')).resolves.toBe(true);
    await expect(util.isRevoked('jti-2')).resolves.toBe(false);
    await expect(util.isRevoked(undefined)).resolves.toBe(false);
    expect(exists).toHaveBeenCalledTimes(2);
  });

  it('Dado Redis caído, cuando el guard consulta, entonces falla ABIERTA (disponibilidad clínica > revocación)', async () => {
    const exists = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const util = makeUtil({ set: jest.fn(), exists });
    await expect(util.isRevoked('jti-1')).resolves.toBe(false);
  });
});
