/**
 * Plantilla de email de marca Keru (KER-55).
 *
 * Renderiza los emails transaccionales con la identidad de Keru ("abrazo profesional",
 * docs/brand/brand-book.md): header con el wordmark, violeta orquídea como acción,
 * tipografía de la marca (con fallbacks web-safe porque los clientes de correo no
 * cargan fuentes propias), CTA destacado y footer con identidad + motivo del envío.
 *
 * Restricciones de compatibilidad de clientes de correo (por eso NO es "HTML normal"):
 * - Estilos 100% INLINE (Gmail/Outlook ignoran <style> y CSS externo).
 * - Layout con TABLAS (no flexbox/grid).
 * - Sin JS. Ancho fijo ~600px. Preheader oculto para el preview del inbox.
 * - Botón CTA "bulletproof" con VML para Outlook (Word engine no respeta border-radius).
 *
 * Logo (KER-64): el wordmark se sirve desde una URL pública HTTPS estable con alt="Keru", NO
 * como data-URI. Gmail y Outlook BLOQUEAN las imágenes data: (cualquier formato) por seguridad,
 * así que el logo caía al texto alt para la mayoría de los clientes; una URL http(s) pública sí
 * renderiza en todos (incluidos Gmail/Outlook). Se prefiere PNG por compat de email (algunos
 * clientes no rasterizan SVG remoto). La URL es configurable por env EMAIL_LOGO_URL (ver
 * email.util.ts) con default DEFAULT_LOGO_URL; el asset canónico es el mismo wordmark que
 * docs/brand/assets/keru-logo.svg, publicado como PNG en el CDN de marca.
 */

// Paleta v2 (brand book §3). Solo los tokens que usa el email; hex explícitos porque
// los clientes de correo no resuelven variables CSS.
const BRAND = {
  ink900: '#2b2733', // texto principal / wordmark
  ink700: '#4b4454', // cuerpo
  ink500: '#6f6779', // secundario / caption
  ink200: '#e9e5ec', // divisores
  primary600: '#7443b0', // CTA / acción primaria (AA sobre blanco y con texto blanco)
  primary700: '#5d3492', // borde inferior del botón (profundidad)
  accent500: '#d96a3d', // punto del logo / acento
  surface: '#ffffff',
  canvas: '#faf8f5', // fondo general (blanco cálido)
  sand100: '#f3eee7', // fondo del footer
} as const;

const PRODUCT_NAME = 'Keru';
const TAGLINE = 'La calma de saber que alguien que sabe está cuidando a quien querés.';

// Familias con fallback web-safe: Georgia evoca la serif de marca (Fraunces) en el título;
// Arial/Helvetica hace las veces de la sans (Figtree) en el cuerpo. Los clientes de correo
// no cargan @font-face propias, así que no las referenciamos.
const FONT_DISPLAY = "Georgia, 'Times New Roman', serif";
const FONT_SANS = "'Helvetica Neue', Arial, sans-serif";

/**
 * URL pública HTTPS por defecto del wordmark para emails (KER-64). PNG (compat de email) con el
 * mismo trazo que docs/brand/assets/keru-logo.svg: la "k" como isotipo + el punto terracota (la
 * persona cuidada). Se sirve desde el CDN de marca (convención cdn.keru.app, la misma de las fotos
 * de paciente). Configurable por EMAIL_LOGO_URL; debe ser una URL estable, no versionada/caducable.
 */
export const DEFAULT_LOGO_URL = 'https://cdn.keru.app/email/keru-logo.png';

/** Contenido de un email transaccional; la fuente única para la parte HTML y la de texto. */
export interface BrandedEmailContent {
  /** Preview text del inbox (preheader oculto). */
  previewText: string;
  /** Título (h1) del cuerpo. */
  heading: string;
  /** Párrafos de introducción antes del CTA (el primero suele ser el saludo). */
  intro: string[];
  /** Botón de acción destacado. */
  cta: { label: string; url: string };
  /** Notas después del CTA (vencimiento, "si no esperabas esto…"). */
  afterCta?: string[];
  /** Motivo por el que la persona recibe el correo (footer). */
  reason: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Botón CTA "bulletproof": tabla con bgcolor inline + fallback VML para Outlook. */
function renderCtaButton(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 4px;">
        <tr>
          <td align="center" bgcolor="${BRAND.primary600}" style="border-radius:9999px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="50%" strokecolor="${BRAND.primary600}" fillcolor="${BRAND.primary600}">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:${FONT_SANS};font-size:16px;font-weight:bold;">${safeLabel}</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT_SANS};font-size:16px;font-weight:bold;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:9999px;background-color:${BRAND.primary600};border-bottom:2px solid ${BRAND.primary700};">${safeLabel}</a>
            <!--<![endif]-->
          </td>
        </tr>
      </table>`;
}

/** Envuelve el contenido en el marco de marca (header con logo, container 600px, footer). */
export function renderBrandedHtml(content: BrandedEmailContent, logoUrl: string = DEFAULT_LOGO_URL): string {
  const introHtml = content.intro
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${FONT_SANS};font-size:16px;line-height:1.55;color:${BRAND.ink700};">${escapeHtml(
          p,
        )}</p>`,
    )
    .join('');

  const afterCtaHtml = (content.afterCta ?? [])
    .map(
      (p) =>
        `<p style="margin:0 0 8px;font-family:${FONT_SANS};font-size:14px;line-height:1.5;color:${BRAND.ink500};">${escapeHtml(
          p,
        )}</p>`,
    )
    .join('');

  const safeUrl = escapeHtml(content.cta.url);
  const safeLogoUrl = escapeHtml(logoUrl);

  return `<!doctype html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.canvas};">
  <!-- Preheader: preview del inbox, oculto del cuerpo. -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.canvas};opacity:0;">${escapeHtml(
    content.previewText,
  )}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.canvas};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${BRAND.surface};border-radius:20px;border:1px solid ${BRAND.ink200};overflow:hidden;">
          <!-- Barra de acento de marca -->
          <tr><td style="height:4px;line-height:4px;font-size:4px;background-color:${BRAND.primary600};">&nbsp;</td></tr>
          <!-- Header con logo -->
          <tr>
            <td align="center" style="padding:28px 32px 8px;">
              <img src="${safeLogoUrl}" width="108" height="44" alt="Keru" style="display:block;border:0;outline:none;text-decoration:none;height:44px;width:108px;">
            </td>
          </tr>
          <!-- Cuerpo -->
          <tr>
            <td style="padding:12px 32px 8px;">
              <h1 style="margin:0 0 16px;font-family:${FONT_DISPLAY};font-size:24px;line-height:1.25;font-weight:normal;color:${BRAND.ink900};">${escapeHtml(
                content.heading,
              )}</h1>
              ${introHtml}
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td align="center" style="padding:8px 32px 4px;">
              ${renderCtaButton(content.cta.label, content.cta.url)}
            </td>
          </tr>
          <!-- Link de respaldo + notas -->
          <tr>
            <td style="padding:8px 32px 20px;">
              <p style="margin:0 0 16px;font-family:${FONT_SANS};font-size:13px;line-height:1.5;color:${BRAND.ink500};">
                ¿No funciona el botón? Copiá y pegá este link en tu navegador:<br>
                <a href="${safeUrl}" target="_blank" style="color:${BRAND.primary700};word-break:break-all;">${safeUrl}</a>
              </p>
              ${afterCtaHtml}
            </td>
          </tr>
          <!-- Divisor -->
          <tr><td style="padding:0 32px;"><div style="border-top:1px solid ${BRAND.ink200};font-size:0;line-height:0;">&nbsp;</div></td></tr>
          <!-- Footer con identidad + motivo -->
          <tr>
            <td style="padding:20px 32px 28px;background-color:${BRAND.sand100};">
              <p style="margin:0 0 8px;font-family:${FONT_SANS};font-size:13px;line-height:1.5;color:${BRAND.ink700};">
                <strong style="color:${BRAND.ink900};">${PRODUCT_NAME}</strong> — ${escapeHtml(TAGLINE)}
              </p>
              <p style="margin:0 0 6px;font-family:${FONT_SANS};font-size:12px;line-height:1.5;color:${BRAND.ink700};">${escapeHtml(
                content.reason,
              )}</p>
              <p style="margin:0;font-family:${FONT_SANS};font-size:12px;line-height:1.5;color:${BRAND.ink500};">Este es un correo automático: no respondas a este mensaje.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Versión TEXTO PLANO de respaldo, derivada del MISMO contenido (mismo link/token). */
export function renderBrandedText(content: BrandedEmailContent): string {
  const lines: string[] = [];
  lines.push(content.heading, '');
  for (const p of content.intro) lines.push(p);
  lines.push('', `${content.cta.label}: ${content.cta.url}`, '');
  for (const p of content.afterCta ?? []) lines.push(p);
  lines.push('', '—', `${PRODUCT_NAME} — ${TAGLINE}`, content.reason, 'Este es un correo automático: no respondas a este mensaje.');
  return lines.join('\n');
}

/** Renderiza ambas partes (HTML + texto) de un email transaccional de marca. */
export function renderBrandedEmail(
  content: BrandedEmailContent,
  logoUrl: string = DEFAULT_LOGO_URL,
): { html: string; text: string } {
  return { html: renderBrandedHtml(content, logoUrl), text: renderBrandedText(content) };
}
