// IDesign
export * from './idesign/idesign';
export * from './idempotency/operation-identity';

// Config
export * from './config/database.config';

// Migraciones (KER-29: esquema versionado, synchronize solo opt-in dev/e2e)
export * from './migrations';

// Outbox / PubSub
export * from './outbox/outbox.constants';
export * from './outbox/outbox-event.entity';
export * from './outbox/pubsub.util';

// Transaction
export * from './transaction/transaction.util';

// Health (KER-33: probes DB/Redis/lag del outbox)
export * from './health/health.util';

// Audit
export * from './audit/audit-log.entity';
export * from './audit/audit.util';

// Email / File storage (SES / S3 — floci en dev)
export * from './email/email.util';
export * from './files/file-storage.util';

// Permission / Authorization
export * from './permission/permission.types';
export * from './permission/authority-provider';
export * from './permission/permission.engine';
export * from './permission/stub-authority.provider';

// Reputation read port (§3.7 Ports & Adapters)
export * from './reputation/reputation-reader';

// Auth (UC-04)
export * from './auth/auth-principal';
export * from './auth/jwt-auth.guard';
export * from './auth/current-account.decorator';
export * from './auth/roles.decorator';
export * from './auth/roles.guard';

// Errors
export * from './errors/error-response';
export * from './errors/all-exceptions.filter';

// Logging estructurado (observabilidad KER-15)
export * from './logging/json-log.util';
export * from './logging/request-logger.middleware';

// Throttling (hardening KER-14)
export * from './throttling/throttling.config';

// Module
export * from './core.module';
