import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { buildTypeOrmOptions } from './config/database.config';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
// NOTA: PermissionEngine y su AuthorityProvider NO se proveen acá — los cablea AuthorizationModule
// (capa de composición) con el adapter real, para no acoplar core a Membership/Hiring (constitution §3.5).
import { OutboxEvent } from './outbox/outbox-event.entity';
import { OUTBOX_QUEUE } from './outbox/outbox.constants';
import { PubSubUtility } from './outbox/pubsub.util';
import { TransactionUtility } from './transaction/transaction.util';
import { AuditLog } from './audit/audit-log.entity';
import { AuditUtility } from './audit/audit.util';
import { EmailUtility } from './email/email.util';
import { FileStorageUtility } from './files/file-storage.util';

/**
 * CoreModule: infraestructura y utilities compartidas (constitution §3, §4).
 * Global: Postgres (TypeORM), Redis (BullMQ), outbox/PubSub, audit, JWT y los guards.
 * La autorización (PermissionEngine) se cablea en AuthorizationModule, no acá.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        // Aísla las colas por entorno cuando comparten Redis (e2e vs API dev): sin esto, el
        // worker de OTRA instancia roba el job y busca el outbox event en la base equivocada.
        prefix: config.get<string>('BULLMQ_PREFIX', 'bull'),
      }),
    }),
    BullModule.registerQueue({ name: OUTBOX_QUEUE }),
    TypeOrmModule.forFeature([OutboxEvent, AuditLog]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES', '7d') as `${number}d` },
      }),
    }),
  ],
  providers: [PubSubUtility, TransactionUtility, AuditUtility, EmailUtility, FileStorageUtility, JwtAuthGuard, RolesGuard],
  exports: [
    PubSubUtility,
    TransactionUtility,
    AuditUtility,
    EmailUtility,
    FileStorageUtility,
    JwtAuthGuard,
    RolesGuard,
    TypeOrmModule,
    BullModule,
    JwtModule,
  ],
})
export class CoreModule {}
