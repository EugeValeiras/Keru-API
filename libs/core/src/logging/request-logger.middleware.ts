import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { AuthPrincipal } from '../auth/auth-principal';
import { logJsonLine } from './json-log.util';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Request con el contexto que el borde HTTP va adjuntando (middleware y guards). */
export interface RequestWithContext extends Request {
  requestId?: string;
  account?: AuthPrincipal;
}

/**
 * Request logging con correlación (KER-15). Como middleware corre antes que los guards,
 * así hasta un 401/429 sale con x-request-id. El log se emite en 'finish', cuando el
 * status es definitivo y JwtAuthGuard ya adjuntó request.account si hubo sesión.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const request = req as RequestWithContext;
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();

  request.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logJsonLine({
      level: res.statusCode >= 500 ? 'error' : 'info',
      msg: 'request',
      requestId,
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ...(request.account ? { accountId: request.account.accountId } : {}),
    });
  });

  next();
}
