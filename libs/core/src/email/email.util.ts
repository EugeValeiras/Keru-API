import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand, VerifyEmailIdentityCommand } from '@aws-sdk/client-ses';

/**
 * EmailUtility (constitution §3.1, utility transversal como Audit/PubSub).
 * Envío de emails vía SES. En dev apunta al emulador floci (AWS_ENDPOINT_URL);
 * en prod usa la cadena de credenciales por defecto (roles IAM, sin claves estáticas).
 * Todo envío es MEJOR ESFUERZO: el que llama no debe bloquear su flujo por un fallo acá.
 */
@Injectable()
export class EmailUtility {
  private readonly logger = new Logger(EmailUtility.name);
  private readonly client: SESClient;
  private readonly from: string;
  private readonly appBaseUrl: string;
  private identityVerified = false;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('AWS_ENDPOINT_URL');
    this.from = this.config.get<string>('SES_FROM', 'no-reply@keru.app');
    this.appBaseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:4200');
    this.client = new SESClient({
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      ...(endpoint
        ? {
            endpoint,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
    });
  }

  /** UC-03: link de invitación por email al invitado nombrado (mejor esfuerzo). */
  async sendInvitationEmail(input: {
    to: string;
    patientName: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const inviteUrl = `${this.appBaseUrl}/invite/${input.token}`;
    await this.send(
      input.to,
      `Te invitaron a acompañar a ${input.patientName} en Keru`,
      [
        `Hola,`,
        ``,
        `Te invitaron a sumarte al círculo de cuidado de ${input.patientName} en Keru.`,
        ``,
        `Aceptá la invitación entrando acá: ${inviteUrl}`,
        ``,
        `El link vence a los 30 minutos y sirve una sola vez.`,
        `Si no esperabas esta invitación, podés ignorar este mensaje.`,
      ].join('\n'),
    );
  }

  private async send(to: string, subject: string, body: string): Promise<void> {
    await this.ensureIdentity();
    await this.client.send(
      new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );
    this.logger.log(`Email enviado a ${to}: ${subject}`);
  }

  /** El emulador (y SES sandbox) exigen identidad verificada del remitente. Lazy, una vez. */
  private async ensureIdentity(): Promise<void> {
    if (this.identityVerified || !this.config.get<string>('AWS_ENDPOINT_URL')) {
      this.identityVerified = true;
      return;
    }
    try {
      await this.client.send(new VerifyEmailIdentityCommand({ EmailAddress: this.from }));
    } catch {
      // Si la verificación falla, el send lo va a reportar con más contexto.
    }
    this.identityVerified = true;
  }
}
