import { PermissionEngine } from './permission.engine';
import { AuthorityProvider } from './authority-provider';

/**
 * KER-57 · Alcance de la LECTURA clínica del cuidador: por VIDA del servicio (asignación viva),
 * NO por la ventana. Contrasta con la ESCRITURA, que sigue atada a la ventana (NFR-30). Prueba
 * que canReadPatient consulta hasLiveServiceRelationship (no hasActiveAssignment) y que el cambio
 * de lectura NO afecta la clasificación de escrituras.
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

const query = { accountId: 'acc-cg', patientId: 'pat-1' };

describe('KER-57 · canReadPatient — lectura por VIDA del servicio, no por ventana', () => {
  it('cuidador con servicio vivo pero FUERA de ventana (inicio futuro): puede LEER', async () => {
    // Repro exacto del bug: asignación aceptada, ventana aún no arrancó (hasActiveAssignment=false)
    // pero la relación de servicio está viva -> la lectura debe autorizar.
    const engine = makeEngine({
      hasLiveServiceRelationship: jest.fn().mockResolvedValue(true),
      hasActiveAssignment: jest.fn().mockResolvedValue(false),
    });
    await expect(engine.canReadPatient(query)).resolves.toBe(true);
  });

  it('vínculo familiar: puede LEER (sin ventana, como siempre)', async () => {
    const engine = makeEngine({ getLinkRoles: jest.fn().mockResolvedValue(['viewer']) });
    await expect(engine.canReadPatient(query)).resolves.toBe(true);
  });

  it('sin vínculo y sin servicio vivo (asignación ya cerrada/histórica): NO puede LEER', async () => {
    const engine = makeEngine({ hasLiveServiceRelationship: jest.fn().mockResolvedValue(false) });
    await expect(engine.canReadPatient(query)).resolves.toBe(false);
  });

  it('la lectura NO mira la ventana: con ventana vigente pero sin relación viva reportada, deniega', async () => {
    // Garantiza que canReadPatient use hasLiveServiceRelationship y NO hasActiveAssignment.
    const engine = makeEngine({
      hasActiveAssignment: jest.fn().mockResolvedValue(true),
      hasLiveServiceRelationship: jest.fn().mockResolvedValue(false),
    });
    await expect(engine.canReadPatient(query)).resolves.toBe(false);
  });
});

describe('KER-57 · la ESCRITURA sigue atada a la ventana (NFR-30 intacto)', () => {
  it('servicio vivo pero fuera de ventana: la escritura NO se autoriza (va a cuarentena vía hasAnyAssignment)', async () => {
    const engine = makeEngine({
      hasLiveServiceRelationship: jest.fn().mockResolvedValue(true),
      hasActiveAssignment: jest.fn().mockResolvedValue(false),
      hasAnyAssignment: jest.fn().mockResolvedValue(true),
    });
    await expect(engine.canRecordClinical(query)).resolves.toBe(false);
    await expect(engine.classifyClinicalWrite(query)).resolves.toBe('quarantine');
  });

  it('dentro de ventana: la escritura se autoriza (la lectura viva no la relaja ni la endurece)', async () => {
    const engine = makeEngine({ hasActiveAssignment: jest.fn().mockResolvedValue(true) });
    await expect(engine.canRecordClinical(query)).resolves.toBe(true);
    await expect(engine.classifyClinicalWrite(query)).resolves.toBe('authorized');
  });
});
