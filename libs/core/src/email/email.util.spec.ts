import { ConfigService } from '@nestjs/config';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { EmailUtility } from './email.util';
import { renderBrandedEmail } from './email.templates';

/**
 * KER-55 · Emails de marca. Cubre (1) el renderer de plantilla: HTML con estilos inline,
 * layout de tablas, logo con alt, CTA destacado y preheader + versión texto plano derivada
 * del mismo contenido; (2) que cada uno de los 3 envíos (invitación, reset, verificación)
 * salga MULTIPART (parte HTML + parte texto) con el mismo link/token en ambas partes; y
 * (3) que el envío siga siendo mejor esfuerzo (no cambia la firma pública de los métodos).
 */

describe('renderBrandedEmail (plantilla de marca)', () => {
  const content = {
    previewText: 'Preview del inbox',
    heading: 'Verificá tu email',
    intro: ['Hola,', 'Creaste una cuenta en Keru con este email.'],
    cta: { label: 'Verificar mi email', url: 'http://localhost:4200/verify-email?token=tok-123' },
    afterCta: ['El link vence a los 30 minutos y sirve una sola vez.'],
    reason: 'Recibiste este correo porque se creó una cuenta en Keru.',
  };

  it('Dado un contenido, cuando renderiza, entonces el HTML tiene estilos inline y layout de tablas', () => {
    const { html } = renderBrandedEmail(content);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<table'); // layout con tablas
    expect(html).toContain('style="'); // estilos inline
    expect(html).not.toContain('<style'); // sin CSS embebido/externo
    expect(html).not.toContain('<script'); // sin JS
  });

  it('Dado un contenido, cuando renderiza, entonces el logo lleva alt y el CTA usa la URL', () => {
    const { html } = renderBrandedEmail(content);
    expect(html).toMatch(/<img[^>]*alt="keru"/); // logo con texto alternativo
    expect(html).toContain('data:image/svg+xml;base64,'); // logo embebido, sin depender de la webapp
    expect(html).toContain('Verificar mi email'); // label del CTA
    expect(html).toContain(content.cta.url); // el CTA apunta al link
  });

  it('Dado un contenido, cuando renderiza, entonces incluye preheader, encabezado, motivo y aviso de no responder', () => {
    const { html } = renderBrandedEmail(content);
    expect(html).toContain('Preview del inbox'); // preheader
    expect(html).toContain('Verificá tu email'); // heading
    expect(html).toContain(content.reason); // motivo del envío en el footer
    expect(html).toContain('no respondas'); // aviso de correo automático
  });

  it('Dado un contenido, cuando renderiza, entonces la parte texto trae el mismo link/token', () => {
    const { html, text } = renderBrandedEmail(content);
    expect(text).toContain(content.cta.url);
    expect(text).toContain('tok-123');
    expect(html).toContain('tok-123');
    // El link/token vive en AMBAS partes (accesibilidad + deliverability).
    expect(text).toContain('Verificar mi email');
    expect(text).not.toContain('<'); // texto plano de verdad, sin markup
  });
});

describe('EmailUtility · envío multipart (HTML + texto)', () => {
  function makeUtil() {
    // Sin AWS_ENDPOINT_URL: ensureIdentity corta en seco (no toca AWS); appBaseUrl usa el default.
    const config = { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService;
    const util = new EmailUtility(config);
    const send = jest.fn().mockResolvedValue({});
    (util as unknown as { client: { send: jest.Mock } }).client.send = send;
    return { util, send };
  }

  function bodyOf(send: jest.Mock) {
    const cmd = send.mock.calls[0][0] as SendEmailCommand;
    const message = cmd.input.Message!;
    return {
      subject: message.Subject!.Data!,
      html: message.Body!.Html!.Data!,
      text: message.Body!.Text!.Data!,
    };
  }

  it('Dado sendInvitationEmail, cuando envía, entonces manda HTML + texto con el mismo token', async () => {
    const { util, send } = makeUtil();
    await util.sendInvitationEmail({ to: 'a@test.com', patientName: 'Rosa', token: 'inv-tok', expiresAt: new Date() });

    const { subject, html, text } = bodyOf(send);
    expect(subject).toContain('Rosa');
    expect(html).toContain('/invite/inv-tok');
    expect(text).toContain('/invite/inv-tok');
    expect(html).toMatch(/<img[^>]*alt="keru"/);
    expect(html).toContain('Aceptar invitación');
  });

  it('Dado sendPasswordResetEmail, cuando envía, entonces manda HTML + texto con el mismo token', async () => {
    const { util, send } = makeUtil();
    await util.sendPasswordResetEmail({ to: 'a@test.com', token: 'reset-tok', expiresAt: new Date() });

    const { html, text } = bodyOf(send);
    expect(html).toContain('password-reset/confirm?token=reset-tok');
    expect(text).toContain('password-reset/confirm?token=reset-tok');
    expect(html).toContain('Crear nueva contraseña');
  });

  it('Dado sendEmailVerificationEmail, cuando envía, entonces manda HTML + texto con el mismo token', async () => {
    const { util, send } = makeUtil();
    await util.sendEmailVerificationEmail({ to: 'a@test.com', token: 'ver-tok', expiresAt: new Date() });

    const { html, text } = bodyOf(send);
    expect(html).toContain('verify-email?token=ver-tok');
    expect(text).toContain('verify-email?token=ver-tok');
    expect(html).toContain('Verificar mi email');
  });

  it('Dado que SES falla, cuando envía, entonces el error se propaga para que el llamador lo trague (mejor esfuerzo)', async () => {
    const { util, send } = makeUtil();
    send.mockRejectedValueOnce(new Error('SES caído'));
    // El util no traga el error: el contrato mejor-esfuerzo lo maneja el llamador (.catch).
    await expect(
      util.sendEmailVerificationEmail({ to: 'a@test.com', token: 't', expiresAt: new Date() }),
    ).rejects.toThrow('SES caído');
  });
});
