import { PermissionEngine } from './permission.engine';
import { AuthorityProvider } from './authority-provider';

/**
 * NFR-30 · Clasificación de la escritura clínica al tiempo de medición: autorizada; llegada
 * tardía de una relación de cuidado → cuarentena; sin relación alguna → prohibida.
 */

function makeEngine(over: Partial<AuthorityProvider> = {}): PermissionEngine {
  const provider: AuthorityProvider = {
    getLinkRoles: jest.fn().mockResolvedValue([]),
    hasActiveAssignment: jest.fn().mockResolvedValue(false),
    hasLiveServiceRelationship: jest.fn().mockResolvedValue(false),
    hasAnyAssignment: jest.fn().mockResolvedValue(false),
    isAdmin: jest.fn().mockResolvedValue(false),
    ...over,
  };
  return new PermissionEngine(provider);
}

const query = { accountId: 'acc-cg', patientId: 'pat-1', at: new Date('2026-07-20T22:30:00Z') };

describe('NFR-30 · classifyClinicalWrite', () => {
  it('con asignación que cubre el tiempo de medición: authorized', async () => {
    const engine = makeEngine({ hasActiveAssignment: jest.fn().mockResolvedValue(true) });
    await expect(engine.classifyClinicalWrite(query)).resolves.toBe('authorized');
  });

  it('con vínculo familiar: authorized', async () => {
    const engine = makeEngine({ getLinkRoles: jest.fn().mockResolvedValue(['manager']) });
    await expect(engine.classifyClinicalWrite(query)).resolves.toBe('authorized');
  });

  it('sin ventana que cubra measuredAt pero con alguna asignación con el paciente: quarantine (nunca descarte silencioso)', async () => {
    const engine = makeEngine({ hasAnyAssignment: jest.fn().mockResolvedValue(true) });
    await expect(engine.classifyClinicalWrite(query)).resolves.toBe('quarantine');
  });

  it('sin relación alguna con el paciente: forbidden', async () => {
    const engine = makeEngine();
    await expect(engine.classifyClinicalWrite(query)).resolves.toBe('forbidden');
  });
});
