import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponse, httpStatusToCode } from './error-response';

/**
 * Filtro global de excepciones (constitution §5). Normaliza toda respuesta de error al
 * shape ErrorResponse para que el cliente móvil maneje errores de forma consistente.
 * Los errores de validación (class-validator) exponen el detalle por campo.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

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

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as { message?: unknown; error?: unknown };
        // ValidationPipe entrega message: string[] -> lo movemos a details.fields.
        if (Array.isArray(body.message)) {
          message = 'Error de validación';
          details = { fields: body.message };
        } else if (typeof body.message === 'string') {
          message = body.message;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    const payload: ErrorResponse = {
      statusCode: status,
      code: httpStatusToCode(status),
      message,
      details,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(payload);
  }
}
