import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { deflateSync } from 'node:zlib';
import { AuthPrincipal, AccountRole, FileStorageUtility } from '@keru/core';
import { Account, AccountAccess, Caregiver, MembershipManager } from '@keru/membership';
import { HiringManager, HiringRequest } from '@keru/hiring';
import { ReputationManager, ReviewAccess } from '@keru/reputation';
import { CareRecordManager } from '@keru/care-record';
import { AppModule } from './app.module';

// --- Avatar PNG de demo (silueta sobre color de marca), sin binarios en el repo ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG 128x128 con la silueta clásica de avatar sobre un color de fondo. */
function avatarPng(bg: [number, number, number]): Buffer {
  const size = 128;
  const fg: [number, number, number] = [248, 250, 252];
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const head = (x - 64) ** 2 + (y - 50) ** 2 <= 22 ** 2;
      const bust = y >= 92 && ((x - 64) / 42) ** 2 + ((y - 118) / 36) ** 2 <= 1;
      const [r, g, b] = head || bust ? fg : bg;
      const px = row + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Datos de demo ---

/** Fecha relativa a hoy (días negativos = pasado) a hora local fija. */
function onDay(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Franja horaria repetida para un rango de días de semana (0=domingo .. 6=sábado). */
function slots(fromDay: number, toDay: number, from: string, to: string) {
  return Array.from({ length: toDay - fromDay + 1 }, (_, i) => ({
    dayOfWeek: fromDay + i,
    from,
    to,
  }));
}

interface SeedCaregiver {
  email: string;
  operationId: string;
  displayName: string;
  zone: string;
  specialties: string[];
  modalities: string[];
  ratePerHour: number;
  rateDescription?: string;
  certifications: Array<{ type: string; institution: string; year: number }>;
  availability: Array<{ dayOfWeek: number; from: string; to: string }>;
  badges?: Partial<Caregiver['badges']>;
  /** Con color se sube un avatar a S3 (floci en dev); sin color, el perfil queda sin foto. */
  photoColor?: [number, number, number];
}

const CAREGIVERS: SeedCaregiver[] = [
  {
    email: 'cuidador@test.com',
    operationId: 'seed-caregiver-laura',
    displayName: 'Laura Gómez',
    zone: 'Palermo, CABA',
    specialties: ['elder-care', 'companionship'],
    modalities: ['home'],
    ratePerHour: 3500,
    rateDescription: 'Incluye acompañamiento nocturno',
    certifications: [{ type: 'Auxiliar de Enfermería', institution: 'Cruz Roja Argentina', year: 2016 }],
    availability: slots(1, 5, '08:00', '16:00'),
    badges: { certifications: true, identity: true, background: true },
    photoColor: [139, 92, 246],
  },
  {
    email: 'cuidador2@test.com',
    operationId: 'seed-caregiver-marta',
    displayName: 'Marta Suárez',
    zone: 'Belgrano, CABA',
    specialties: ['elder-care', 'chronic-illness'],
    modalities: ['home', 'hospital'],
    ratePerHour: 4200,
    certifications: [{ type: 'Enfermería', institution: 'Universidad de Buenos Aires', year: 2012 }],
    availability: slots(1, 6, '07:00', '15:00'),
    badges: { certifications: true, identity: true },
    photoColor: [236, 72, 153],
  },
  {
    email: 'cuidador3@test.com',
    operationId: 'seed-caregiver-carlos',
    displayName: 'Carlos Benítez',
    zone: 'Caballito, CABA',
    specialties: ['post-surgical', 'rehabilitation'],
    modalities: ['home', 'hospital'],
    ratePerHour: 5000,
    rateDescription: 'Sesiones de rehabilitación de 2 horas mínimo',
    certifications: [
      { type: 'Kinesiología', institution: 'Universidad Nacional de La Plata', year: 2010 },
      { type: 'RCP y primeros auxilios', institution: 'SAME', year: 2021 },
    ],
    availability: slots(1, 5, '09:00', '18:00'),
    badges: { certifications: true, identity: true, background: true },
  },
  {
    email: 'cuidador4@test.com',
    operationId: 'seed-caregiver-ana',
    displayName: 'Ana Paredes',
    zone: 'Vicente López, GBA Norte',
    specialties: ['palliative', 'elder-care'],
    modalities: ['home'],
    ratePerHour: 6500,
    rateDescription: 'Cuidados paliativos domiciliarios',
    certifications: [
      { type: 'Enfermería', institution: 'Universidad Austral', year: 2008 },
      { type: 'Cuidados paliativos', institution: 'Pallium Latinoamérica', year: 2018 },
    ],
    availability: slots(0, 6, '08:00', '20:00'),
    badges: { certifications: true, identity: true, background: true },
    photoColor: [16, 185, 129],
  },
  {
    email: 'cuidador5@test.com',
    operationId: 'seed-caregiver-jorge',
    displayName: 'Jorge Medina',
    zone: 'La Plata, Buenos Aires',
    specialties: ['disability', 'companionship'],
    modalities: ['home'],
    ratePerHour: 2800,
    certifications: [{ type: 'Acompañante terapéutico', institution: 'Universidad Nacional de La Plata', year: 2019 }],
    availability: slots(1, 5, '14:00', '22:00'),
    badges: { identity: true },
  },
  {
    email: 'cuidador6@test.com',
    operationId: 'seed-caregiver-silvia',
    displayName: 'Silvia Romano',
    zone: 'Flores, CABA',
    specialties: ['chronic-illness', 'elder-care'],
    modalities: ['home', 'hospital'],
    ratePerHour: 3900,
    certifications: [
      { type: 'Auxiliar de Enfermería', institution: 'Cruz Roja Argentina', year: 2014 },
      { type: 'Diabetes y nutrición', institution: 'Hospital Italiano', year: 2020 },
    ],
    availability: slots(2, 6, '08:00', '17:00'),
    badges: { certifications: true, identity: true },
    photoColor: [245, 158, 11],
  },
  {
    email: 'cuidador7@test.com',
    operationId: 'seed-caregiver-pedro',
    displayName: 'Pedro Aguirre',
    zone: 'San Isidro, GBA Norte',
    specialties: ['pediatric', 'post-surgical'],
    modalities: ['hospital'],
    ratePerHour: 5500,
    certifications: [{ type: 'Enfermería pediátrica', institution: 'Hospital Garrahan', year: 2015 }],
    availability: slots(4, 6, '10:00', '22:00'),
    badges: { certifications: true, identity: true, background: true },
  },
  {
    email: 'cuidador8@test.com',
    operationId: 'seed-caregiver-nadia',
    displayName: 'Nadia Kaplan',
    zone: 'Almagro, CABA',
    specialties: ['elder-care', 'palliative', 'companionship'],
    modalities: ['home'],
    ratePerHour: 4700,
    certifications: [{ type: 'Gerontología', institution: 'Universidad Maimónides', year: 2017 }],
    availability: slots(1, 6, '08:00', '14:00'),
    badges: { identity: true, background: true },
    photoColor: [59, 130, 246],
  },
];

/** ~2 semanas de vitales de Rosa: [días atrás, sistólica, diastólica, pulso, temp, SpO2, autor]. */
const ROSA_VITALS: Array<[number, number, number, number, number, number, 'laura' | 'juan']> = [
  [14, 128, 78, 72, 36.4, 97, 'laura'],
  [13, 124, 76, 70, 36.5, 97, 'laura'],
  [12, 131, 82, 75, 36.6, 96, 'juan'],
  [11, 126, 79, 71, 36.4, 98, 'laura'],
  [10, 135, 85, 78, 36.7, 96, 'laura'],
  [9, 122, 74, 69, 36.3, 97, 'laura'],
  [8, 129, 80, 73, 36.5, 97, 'juan'],
  [7, 138, 88, 80, 36.8, 95, 'laura'],
  [6, 133, 84, 76, 36.6, 96, 'laura'],
  [5, 127, 78, 72, 36.4, 97, 'laura'],
  [4, 168, 98, 92, 36.9, 94, 'laura'], // pico hipertensivo -> alertas al círculo
  [3, 152, 94, 86, 36.7, 95, 'laura'], // sigue elevada -> alerta
  [2, 136, 86, 77, 36.5, 96, 'laura'],
  [1, 130, 81, 74, 36.4, 97, 'juan'],
];

const ROSA_NOTES: Array<[number, string, 'laura' | 'juan']> = [
  [12, 'Caminata de 20 minutos por la plaza. Volvió con buen ánimo y almorzó completo.', 'laura'],
  [9, 'Durmió toda la noche sin interrupciones. Se la nota más descansada.', 'laura'],
  [7, 'La visité a la tarde: la noté un poco cansada, pero de buen humor.', 'juan'],
  [4, 'Amaneció con dolor de cabeza y mareos. Presión elevada: avisé a la familia y refuerzo controles cada 2 horas.', 'laura'],
  [2, 'Presión estabilizada. Retomó la caminata corta y comió muy bien.', 'laura'],
];

/** Glucemias de Ernesto: [días atrás, mg/dL]. La de 185 dispara alerta (rango 70-140). */
const ERNESTO_GLUCOSE: Array<[number, number]> = [
  [6, 132],
  [3, 185],
  [1, 118],
];

/**
 * Seed idempotente de datos de demo. Ejecutar con infra levantada:
 *   npm run infra:up && npm run seed
 *
 * Correrlo dos veces seguidas no duplica nada: cuentas por email único, perfiles/pacientes/
 * solicitudes/registros clínicos por operationId fijo, transiciones de estado guardadas por
 * status y reseñas por unique(requestId, autor).
 */
async function seed() {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const accounts = app.get(AccountAccess, { strict: false });
  const membership = app.get(MembershipManager, { strict: false });
  const hiring = app.get(HiringManager, { strict: false });
  const reputation = app.get(ReputationManager, { strict: false });
  const reviewAccess = app.get(ReviewAccess, { strict: false });
  const careRecord = app.get(CareRecordManager, { strict: false });
  const files = app.get(FileStorageUtility, { strict: false });

  async function ensureAccount(email: string, role: AccountRole, displayName: string): Promise<Account> {
    const existing = await accounts.findAccountByEmail(email);
    if (existing) return existing;
    const res = await membership.signup({ email, password: 'S3gura!123', role, displayName });
    return (await accounts.findAccountByEmail(res.email))!;
  }

  const principal = (account: Account): AuthPrincipal => ({
    accountId: account.id,
    email: account.email,
    role: account.role,
  });

  /** Perfil de cuidador aprobado (con foto opcional subida a S3 solo al crearlo). */
  async function ensureApprovedCaregiver(
    data: SeedCaregiver,
    admin: Account,
  ): Promise<{ profile: Caregiver; account: Account }> {
    const account = await ensureAccount(data.email, 'caregiver', data.displayName);
    let profile = await membership.getMyCaregiverProfile(account.id);
    if (!profile) {
      let photoUrl: string | undefined;
      if (data.photoColor) {
        try {
          photoUrl = (await files.putImage(avatarPng(data.photoColor), 'image/png')).url;
        } catch (err) {
          logger.warn(`Sin foto para ${data.displayName} (S3 no disponible): ${(err as Error).message}`);
        }
      }
      profile = await membership.registerCaregiver(
        {
          operationId: data.operationId,
          displayName: data.displayName,
          photoUrl,
          specialties: data.specialties,
          certifications: data.certifications,
          availability: data.availability,
          rates: { ratePerHour: data.ratePerHour, currency: 'ARS', description: data.rateDescription },
          zone: data.zone,
          modalities: data.modalities,
        },
        account.id,
      );
    }
    if (profile.status === 'pending') {
      profile = await membership.approveCaregiver(profile.id, admin.id);
    }
    // También completa insignias de un perfil pre-existente (p.ej. creado por e2e); solo si difieren.
    const badges = data.badges ?? {};
    if (
      profile.status === 'approved' &&
      (Object.keys(badges) as Array<keyof Caregiver['badges']>).some((k) => profile!.badges?.[k] !== badges[k])
    ) {
      profile = await membership.setCaregiverBadges(profile.id, admin.id, badges);
    }
    return { profile, account };
  }

  /** Lleva una solicitud hasta `finished` (crear -> aceptar -> completar), retomable por status. */
  async function ensureFinishedHire(
    operationId: string,
    patientId: string,
    caregiver: { profile: Caregiver; account: Account },
    requester: Account,
    startDaysAgo: number,
    endDaysAgo: number,
  ): Promise<HiringRequest> {
    let request = await hiring.createRequest(
      {
        operationId,
        patientId,
        caregiverId: caregiver.profile.id,
        modality: 'home',
        startDate: onDay(-startDaysAgo, 8).toISOString(),
        endDate: onDay(-endDaysAgo, 18).toISOString(),
        contactData: { phone: '+54 11 5555-5555' },
      },
      requester.id,
    );
    if (request.status === 'pending') {
      request = (await hiring.acceptRequest(request.id, caregiver.account.id)).request;
    }
    if (request.status === 'accepted' || request.status === 'in-progress') {
      request = await hiring.completeRequest(request.id, requester.id);
    }
    return request;
  }

  /** Reseñas de ambas partes de un servicio finalizado (reveal simultáneo, NFR-21). */
  async function ensureReviewPair(
    request: HiringRequest,
    family: Account,
    caregiverAccount: Account,
    caregiverRating: number,
    caregiverComment: string,
    patientRating: number,
    patientComment: string,
  ): Promise<void> {
    if (request.status !== 'finished') {
      logger.warn(`Solicitud ${request.id} en estado ${request.status}: se omiten sus reseñas`);
      return;
    }
    if (!(await reviewAccess.findByRequestAndAuthor(request.id, family.id))) {
      await reputation.reviewCaregiver(request.id, family.id, caregiverRating, caregiverComment);
    }
    if (!(await reviewAccess.findByRequestAndAuthor(request.id, caregiverAccount.id))) {
      await reputation.reviewPatient(request.id, caregiverAccount.id, patientRating, patientComment);
    }
  }

  // --- Cuentas base ---
  const admin = await ensureAccount('admin@test.com', 'admin', 'Admin Keru');
  const juan = await ensureAccount('familiar@test.com', 'family', 'Juan Díaz');

  // --- ~8 cuidadores aprobados, variados en zona/especialidad/tarifa ---
  const caregivers = new Map<string, { profile: Caregiver; account: Account }>();
  for (const data of CAREGIVERS) {
    caregivers.set(data.operationId, await ensureApprovedCaregiver(data, admin));
  }
  const laura = caregivers.get('seed-caregiver-laura')!;
  const marta = caregivers.get('seed-caregiver-marta')!;
  const carlos = caregivers.get('seed-caregiver-carlos')!;

  // --- Pacientes de la cuenta familiar ---
  const rosa = (
    await membership.registerPatient(
      {
        operationId: 'seed-patient-rosa',
        fullName: 'Rosa Díaz',
        birthDate: '1948-03-10',
        mainCondition: 'Hipertensión',
        bloodGroup: '0+',
        allergies: ['Penicilina'],
        emergencyContact: { name: 'Juan Díaz', phone: '+54 11 5555-5555', relationship: 'hijo' },
      },
      juan.id,
    )
  ).patient;

  const ernesto = (
    await membership.registerPatient(
      {
        operationId: 'seed-patient-ernesto',
        fullName: 'Ernesto Díaz',
        birthDate: '1943-11-02',
        mainCondition: 'Diabetes tipo 2',
        bloodGroup: 'A+',
        allergies: [],
        emergencyContact: { name: 'Juan Díaz', phone: '+54 11 5555-5555', relationship: 'hijo' },
      },
      juan.id,
    )
  ).patient;

  // --- Servicios finalizados + reseñas reveladas (ratings variados) ---
  await ensureReviewPair(
    await ensureFinishedHire('seed-hire-laura-1', rosa.id, laura, juan, 90, 76),
    juan,
    laura.account,
    5,
    'Excelente con mi mamá: puntual, cariñosa y muy profesional.',
    5,
    'Rosa es un amor y la familia está siempre presente.',
  );
  await ensureReviewPair(
    await ensureFinishedHire('seed-hire-laura-2', rosa.id, laura, juan, 60, 46),
    juan,
    laura.account,
    5,
    'Volvimos a convocarla: de total confianza.',
    5,
    'Segundo servicio con Rosa, todo impecable.',
  );
  await ensureReviewPair(
    await ensureFinishedHire('seed-hire-laura-3', rosa.id, laura, juan, 30, 21),
    juan,
    laura.account,
    4,
    'Muy buena atención, aunque algunos días llegaba justa de horario.',
    4,
    'Buen trato, hubo que reprogramar un par de visitas.',
  );
  await ensureReviewPair(
    await ensureFinishedHire('seed-hire-marta-1', rosa.id, marta, juan, 120, 106),
    juan,
    marta.account,
    4,
    'Muy prolija con la medicación y los controles de presión.',
    4,
    'Paciente tranquila, indicaciones claras de la familia.',
  );
  await ensureReviewPair(
    await ensureFinishedHire('seed-hire-marta-2', rosa.id, marta, juan, 45, 38),
    juan,
    marta.account,
    3,
    'Cumplió con el servicio, aunque nos costó coordinar los horarios.',
    4,
    'Todo bien, con algunos cambios de agenda de último momento.',
  );
  await ensureReviewPair(
    await ensureFinishedHire('seed-hire-carlos-1', ernesto.id, carlos, juan, 40, 33),
    juan,
    carlos.account,
    5,
    'La rehabilitación de mi papá avanzó muchísimo con Carlos.',
    5,
    'Ernesto es muy colaborador con los ejercicios.',
  );

  // --- Servicio vigente de Laura con Rosa (la habilita a registrar la historia clínica, NFR-30) ---
  const activeRequest = await hiring.createRequest(
    {
      operationId: 'seed-hire-laura-activa',
      patientId: rosa.id,
      caregiverId: laura.profile.id,
      modality: 'home',
      startDate: onDay(-16, 8).toISOString(),
      endDate: onDay(14, 18).toISOString(),
      contactData: { phone: '+54 11 5555-5555' },
    },
    juan.id,
  );
  if (activeRequest.status === 'pending') {
    await hiring.acceptRequest(activeRequest.id, laura.account.id);
  }

  // --- ~2 semanas de historia clínica de Rosa: vitales diarios + medicación + novedades ---
  const authors = { laura: laura.account, juan };
  for (const [day, sys, dia, hr, temp, spo2, author] of ROSA_VITALS) {
    await careRecord.recordVitals(
      rosa.id,
      {
        operationId: `seed-rosa-vitals-d${day}`,
        measuredAt: onDay(-day, 9).toISOString(),
        values: [
          { metricKey: 'blood-pressure-systolic', value: sys },
          { metricKey: 'blood-pressure-diastolic', value: dia },
          { metricKey: 'heart-rate', value: hr },
          { metricKey: 'temperature', value: temp },
          { metricKey: 'oxygen-saturation', value: spo2 },
        ],
      },
      principal(authors[author]),
    );
    await careRecord.recordMedication(
      rosa.id,
      {
        operationId: `seed-rosa-med-d${day}`,
        measuredAt: onDay(-day, 8).toISOString(),
        medication: 'Enalapril',
        dose: '10 mg',
        schedule: '08:00',
        observations: day === 4 ? 'Se administró con la presión alta; se refuerzan los controles' : undefined,
      },
      principal(authors[author]),
    );
  }
  for (const [day, text, author] of ROSA_NOTES) {
    await careRecord.recordNote(
      rosa.id,
      { operationId: `seed-rosa-note-d${day}`, measuredAt: onDay(-day, 17).toISOString(), text },
      principal(authors[author]),
    );
  }

  // --- Controles de glucemia de Ernesto (uno fuera de rango -> alerta) ---
  for (const [day, value] of ERNESTO_GLUCOSE) {
    await careRecord.recordVitals(
      ernesto.id,
      {
        operationId: `seed-ernesto-glucosa-d${day}`,
        measuredAt: onDay(-day, 10).toISOString(),
        values: [{ metricKey: 'glucose', value }],
      },
      principal(juan),
    );
  }
  await careRecord.recordNote(
    ernesto.id,
    {
      operationId: 'seed-ernesto-note-d3',
      measuredAt: onDay(-3, 15).toISOString(),
      text: 'Glucemia alta después del almuerzo familiar. Volvemos a la dieta indicada y repetimos control mañana.',
    },
    principal(juan),
  );

  logger.log('Seed completo. Cuentas: familiar@test.com / admin@test.com (pass: S3gura!123)');
  logger.log(`Cuidadores aprobados: ${CAREGIVERS.map((c) => `${c.displayName} <${c.email}>`).join(', ')}`);
  logger.log('Pacientes demo: Rosa Díaz y Ernesto Díaz (vinculados a familiar@test.com)');
  logger.log('Rosa: 2 semanas de vitales/medicación/novedades con pico hipertensivo (alertas) y servicio vigente de Laura');
  await app.close();
}

void seed();
