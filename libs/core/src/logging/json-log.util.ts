/**
 * Log estructurado (KER-15): una línea JSON parseable por registro, directo a stdout.
 * Sin pino ni transportes: el volumen del MVP no lo justifica y cualquier colector
 * (CloudWatch, Loki, docker logs | jq) ingiere JSON-por-línea tal cual.
 */
export function logJsonLine(record: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
}
