import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { Favorite } from './entities/favorite.entity';

/** FavoriteAccess (UC-08). Marcar/desmarcar idempotente, persistente por cuenta. */
@ResourceAccess()
@Injectable()
export class FavoriteAccess {
  constructor(@InjectRepository(Favorite) private readonly favorites: Repository<Favorite>) {}

  /** Idempotente: si ya existe, no duplica. */
  async add(accountId: string, caregiverId: string): Promise<void> {
    const existing = await this.favorites.findOne({ where: { accountId, caregiverId } });
    if (!existing) await this.favorites.save(this.favorites.create({ accountId, caregiverId }));
  }

  async remove(accountId: string, caregiverId: string): Promise<void> {
    await this.favorites.delete({ accountId, caregiverId });
  }

  async listCaregiverIds(accountId: string): Promise<string[]> {
    const rows = await this.favorites.find({ where: { accountId } });
    return rows.map((r) => r.caregiverId);
  }
}
