import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { logJsonLine } from '../logging/json-log.util';
import { RequestWithContext } from '../logging/request-logger.middleware';
import { ErrorResponse, httpStatusToCode } from './error-response';

/**
 * Filtro global de excepciones (constitution §5). Normaliza toda respuesta de error al
 * shape ErrorResponse para que el cliente móvil maneje errores de forma consistente.
 * Los errores de validación (class-validator) exponen el detalle por campo.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Error interno';
    let details: unknown;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as { message?: unknown; error?: unknown; code?: unknown };
        // ValidationPipe entrega message: string[] -> lo movemos a details.fields.
        if (Array.isArray(body.message)) {
          message = 'Error de validación';
          details = { fields: body.message };
        } else if (typeof body.message === 'string') {
          message = body.message;
        }
        // Código específico del dominio (p. ej. STEP_UP_REQUIRED): pisa el genérico por status.
        if (typeof body.code === 'string') code = body.code;
      }
    }

    // Observabilidad KER-15: todo 5xx deja el stack correlacionado por request-id.
    if (status >= 500 && exception instanceof Error) {
      logJsonLine({
        level: 'error',
        msg: exception.message,
        requestId: (request as RequestWithContext).requestId,
        method: request.method,
        path: request.url,
        statusCode: status,
        stack: exception.stack,
      });
    }

    const payload: ErrorResponse = {
      statusCode: status,
      code: code ?? httpStatusToCode(status),
      message,
      details,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(payload);
  }
}
