/** Forma estándar de toda respuesta de error de la API. El cliente móvil puede depender de este shape. */
export interface ErrorResponse {
  statusCode: number;
  /** Código legible por máquina, p. ej. VALIDATION_ERROR, FORBIDDEN, CONFLICT, UNAUTHORIZED. */
  code: string;
  message: string;
  /** Detalle opcional (p. ej. errores por campo en validación). */
  details?: unknown;
  path: string;
  timestamp: string;
}

/** Mapa status HTTP -> código legible. */
export function httpStatusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'TOO_MANY_REQUESTS',
    500: 'INTERNAL_ERROR',
  };
  return map[status] ?? 'ERROR';
}
