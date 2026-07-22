#!/usr/bin/env node
/**
 * Gate E2E del producto (UC-18/KER-4): la suite Playwright vive en Keru-Webapp, pero el
 * comando de verificación corre en este repo. Este script resuelve el checkout de la webapp
 * y corre `npm run e2e` ahí, contra el entorno ya levantado (ver playwright.config.ts de la
 * webapp: E2E_BASE_URL o su archivo .e2e-base-url deciden el origen).
 *
 * Resolución del checkout de la webapp, en orden:
 *   1. KERU_WEBAPP_DIR (misma convención que docker-compose.yml)
 *   2. El worktree hermano de la misma tarea kanban (…/Keru-API/.kanban/worktrees/<t> → …/Keru-Webapp/.kanban/worktrees/<t>)
 *   3. El checkout hermano ../Keru-Webapp
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const cwd = process.cwd();

function candidates() {
  const list = [];
  if (process.env.KERU_WEBAPP_DIR) list.push(resolve(process.env.KERU_WEBAPP_DIR));
  const sibling = cwd.replace(/([\\/])Keru-API([\\/])/, '$1Keru-Webapp$2');
  if (sibling !== cwd) list.push(sibling);
  list.push(resolve(cwd, '..', 'Keru-Webapp'));
  return list;
}

const webappDir = candidates().find((dir) => existsSync(join(dir, 'playwright.config.ts')));
if (!webappDir) {
  console.error('No encuentro el checkout de Keru-Webapp (probé KERU_WEBAPP_DIR, el worktree hermano y ../Keru-Webapp).');
  process.exit(1);
}

console.log(`E2E de la webapp en: ${webappDir}`);
const result = spawnSync('npm', ['run', 'e2e'], { cwd: webappDir, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
