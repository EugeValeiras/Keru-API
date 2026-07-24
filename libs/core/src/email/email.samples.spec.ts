import { ConfigService } from '@nestjs/config';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EmailUtility } from './email.util';

/**
 * KER-55 · Muestras de los 3 emails de marca para inspección visual (criterio 5).
 *
 * Captura el HTML REAL que produce cada método de EmailUtility (sin duplicar el copy) y,
 * cuando se corre con WRITE_EMAIL_SAMPLES=1, lo vuelca a docs/email-samples/*.html para
 * abrirlos en el navegador y revisar el look de marca. En CI (sin la env) no escribe nada:
 * solo verifica que cada muestra sea branded (logo con alt + CTA). Regenerar con:
 *   WRITE_EMAIL_SAMPLES=1 npx jest email.samples
 */

function captureHtml(run: (u: EmailUtility) => Promise<void>): Promise<string> {
  const config = { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService;
  const util = new EmailUtility(config);
  const send = jest.fn().mockResolvedValue({});
  (util as unknown as { client: { send: jest.Mock } }).client.send = send;
  return run(util).then(() => {
    const cmd = send.mock.calls[0][0] as SendEmailCommand;
    return cmd.input.Message!.Body!.Html!.Data!;
  });
}

const SAMPLES: Array<{ file: string; run: (u: EmailUtility) => Promise<void> }> = [
  {
    file: 'invitation.html',
    run: (u) =>
      u.sendInvitationEmail({ to: 'ana@example.com', patientName: 'Rosa', token: 'inv-demo-123', expiresAt: new Date() }),
  },
  {
    file: 'password-reset.html',
    run: (u) => u.sendPasswordResetEmail({ to: 'ana@example.com', token: 'reset-demo-123', expiresAt: new Date() }),
  },
  {
    file: 'email-verification.html',
    run: (u) => u.sendEmailVerificationEmail({ to: 'ana@example.com', token: 'verify-demo-123', expiresAt: new Date() }),
  },
];

describe('KER-55 · muestras de email de marca', () => {
  const outDir = join(__dirname, '../../../../docs/email-samples');
  const shouldWrite = process.env.WRITE_EMAIL_SAMPLES === '1';

  if (shouldWrite) mkdirSync(outDir, { recursive: true });

  it.each(SAMPLES)('$file es un email branded (logo con alt + CTA); se guarda la muestra', async ({ file, run }) => {
    const html = await captureHtml(run);
    expect(html).toMatch(/<img[^>]*alt="keru"/);
    expect(html).toContain('href='); // el CTA/link está presente
    if (shouldWrite) writeFileSync(join(outDir, file), html, 'utf-8');
  });
});
