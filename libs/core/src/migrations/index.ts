/**
 * Registro explícito de migraciones (KER-29). El esquema vive acá, versionado — no en
 * `synchronize` (NFR-25: el store clínico no se altera en silencio). Sin globs: el array
 * funciona igual en ts-node (CLI), jest y el build compilado de Nest.
 *
 * Alta de una migración: `npm run migration:generate -- libs/core/src/migrations/<Nombre>`
 * contra una base con el esquema vigente, y sumar la clase generada a este array.
 */
import { InitialSchema1784783279894 } from './1784783279894-InitialSchema';
import { SeparateCompletionFromPaidDeclared1784786611330 } from './1784786611330-SeparateCompletionFromPaidDeclared';

export const ALL_MIGRATIONS: Array<new () => unknown> = [
  InitialSchema1784783279894,
  SeparateCompletionFromPaidDeclared1784786611330,
];
