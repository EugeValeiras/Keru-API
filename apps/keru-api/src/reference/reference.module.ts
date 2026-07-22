import { Module } from '@nestjs/common';
import { ReferenceController } from './reference.controller';

/** Reference: catálogos estáticos para los clientes (nivel app, sin estado). */
@Module({ controllers: [ReferenceController] })
export class ReferenceModule {}
