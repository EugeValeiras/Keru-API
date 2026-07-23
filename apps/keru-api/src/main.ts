import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '@keru/core';
import { AppModule } from './app.module';

function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Keru API')
    .setDescription(
      'Backend del MVP de Keru (marketplace de cuidadores). Contrato para clientes ' +
        '(app móvil y web). Ver casos de uso en Keru-Casos-de-Uso-MVP.md y reglas en constitution.md.',
    )
    .setVersion('0.1.0')
    // Sesión/rol (UC-04, aún placeholder por header x-account-id).
    .addApiKey({ type: 'apiKey', name: 'x-account-id', in: 'header' }, 'account')
    .addBearerAuth() // reservado para el JWT real cuando exista UC-04
    .build();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // La app corre detrás de CloudFront + ALB. Sin esto, Express toma req.ip = IP del nodo del
  // ALB (igual para TODOS los clientes), y el rate limiting por-IP del ThrottlerGuard se vuelve
  // global (5 logins/min para todo el sistema). Confiamos EXACTAMENTE 2 hops (ALB + CloudFront)
  // para obtener la IP real del cliente; 'true' confiaría en toda la cadena XFF y sería spoofeable.
  app.getHttpAdapter().getInstance().set('trust proxy', 2);

  app.enableCors(); // dev: abierto; en prod restringir origins por env.
  // KER-33: sin esto, un SIGTERM (deploy) mata el proceso con jobs BullMQ a mitad de vuelo.
  // Con los hooks, @nestjs/bullmq cierra el worker en onApplicationShutdown esperando el job activo.
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }); // /api/v1/...
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup('api/docs', app, document);

  // Genera el contrato estático (openapi.json) para que otro agente arme la app móvil, y sale.
  if (process.env.GENERATE_OPENAPI === 'true') {
    const out = join(process.cwd(), 'openapi.json');
    writeFileSync(out, JSON.stringify(document, null, 2));
    Logger.log(`openapi.json generado en ${out}`, 'Swagger');
    await app.close();
    return;
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Keru API en http://localhost:${port}/api/v1 · Swagger en /api/docs`, 'Bootstrap');
}

void bootstrap();
