import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand, VerifyEmailIdentityCommand } from '@aws-sdk/client-ses';
import { BrandedEmailContent, renderBrandedEmail } from './email.templates';

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
    await this.send(input.to, `Te invitaron a acompañar a ${input.patientName} en Keru`, {
      previewText: `Aceptá la invitación para acompañar a ${input.patientName} en Keru.`,
      heading: 'Te invitaron a un círculo de cuidado',
      intro: [
        'Hola,',
        `Te invitaron a sumarte al círculo de cuidado de ${input.patientName} en Keru: el lugar donde la familia y los cuidadores acompañan juntos, con todo a la vista.`,
      ],
      cta: { label: 'Aceptar invitación', url: inviteUrl },
      afterCta: [
        'El link vence a los 30 minutos y sirve una sola vez.',
        'Si no esperabas esta invitación, podés ignorar este mensaje.',
      ],
      reason: `Recibiste este correo porque alguien te invitó a acompañar a ${input.patientName} en Keru.`,
    });
  }

  /** UC-04 A4: link de recuperación de contraseña (token de un solo uso, mejor esfuerzo). */
  async sendPasswordResetEmail(input: { to: string; token: string; expiresAt: Date }): Promise<void> {
    const resetUrl = `${this.appBaseUrl}/password-reset/confirm?token=${input.token}`;
    await this.send(input.to, 'Recuperá tu contraseña de Keru', {
      previewText: 'Creá una nueva contraseña para tu cuenta de Keru.',
      heading: 'Recuperá tu contraseña',
      intro: ['Hola,', 'Recibimos un pedido para restablecer la contraseña de tu cuenta de Keru.'],
      cta: { label: 'Crear nueva contraseña', url: resetUrl },
      afterCta: [
        'El link vence a los 30 minutos y sirve una sola vez.',
        'Si no pediste esto, podés ignorar este mensaje: tu contraseña no cambia hasta que uses el link.',
      ],
      reason: 'Recibiste este correo porque se pidió recuperar la contraseña de esta cuenta de Keru.',
    });
  }

  /** UC-04 A5: link de verificación de email del self-signup (token de un solo uso, mejor esfuerzo). */
  async sendEmailVerificationEmail(input: { to: string; token: string; expiresAt: Date }): Promise<void> {
    const verifyUrl = `${this.appBaseUrl}/verify-email?token=${input.token}`;
    await this.send(input.to, 'Verificá tu email en Keru', {
      previewText: 'Verificá tu email para activar del todo tu cuenta de Keru.',
      heading: 'Verificá tu email',
      intro: [
        'Hola,',
        'Creaste una cuenta en Keru con este email. Para activarla del todo, confirmá que el email es tuyo.',
      ],
      cta: { label: 'Verificar mi email', url: verifyUrl },
      afterCta: [
        'El link vence a los 30 minutos y sirve una sola vez.',
        'Si no creaste esta cuenta, podés ignorar este mensaje.',
      ],
      reason: 'Recibiste este correo porque se creó una cuenta en Keru con esta dirección.',
    });
  }

  private async send(to: string, subject: string, content: BrandedEmailContent): Promise<void> {
    await this.ensureIdentity();
    const { html, text } = renderBrandedEmail(content);
    await this.client.send(
      new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          // Multipart alternativo: SES arma text/plain + text/html; el cliente elige.
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' },
          },
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
