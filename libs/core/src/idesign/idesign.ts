/**
 * Marcadores IDesign (constitution §3.1).
 *
 * Son decoradores/aliases sin comportamiento en runtime: documentan el estereotipo
 * de cada clase y hacen explícita la capa a la que pertenece. La frontera real se
 * enforza en ESLint (constitution §3.4). Cada dominio ubica sus clases así:
 *
 *   libs/<dominio>/src/manager/**          -> @Manager      (orquestador con estado por workflow)
 *   libs/<dominio>/src/engine/**           -> @Engine       (cálculo puro, sin estado)
 *   libs/<dominio>/src/resource-access/**  -> @ResourceAccess (verbos atómicos sobre datos)
 */

/** Manager: orquesta un workflow. "El qué / porqué". Puede llamar Engines y ResourceAccess. */
export const Manager = (): ClassDecorator => () => undefined;

/** Engine: cálculo puro, sin estado. "El cómo". Solo lee ResourceAccess. Nunca llama Managers. */
export const Engine = (): ClassDecorator => () => undefined;

/** ResourceAccess: verbos atómicos sobre datos. Única capa que toca Resources. Sin llamadas de costado. */
export const ResourceAccess = (): ClassDecorator => () => undefined;
