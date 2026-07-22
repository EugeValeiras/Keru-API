import { Injectable } from '@nestjs/common';
import { Engine } from '@keru/core';
import { CaregiverAccess, Caregiver } from '@keru/membership';

export interface SearchFilters {
  careType?: string;
  modality?: string;
  zone?: string;
  minRatePerHour?: number;
  maxRatePerHour?: number;
}

/**
 * MatchingEngine (constitution §3.1). Cálculo puro: filtra y rankea cuidadores APROBADOS y
 * visibles por zona, modalidad, tipo de cuidado y tarifa vigente. Lee el perfil de cuidador
 * como réplica de solo-lectura (dueño de escritura: Membership). Solo aprobados salen (I1).
 */
@Engine()
@Injectable()
export class MatchingEngine {
  constructor(private readonly caregivers: CaregiverAccess) {}

  async match(filters: SearchFilters): Promise<Caregiver[]> {
    const approved = await this.caregivers.listByStatus('approved'); // I1
    return approved.filter((c) => this.matches(c, filters));
  }

  private matches(c: Caregiver, f: SearchFilters): boolean {
    if (f.careType && !c.specialties.includes(f.careType)) return false;
    if (f.modality && !c.modalities.includes(f.modality)) return false;
    if (f.zone && !c.zone.toLowerCase().includes(f.zone.toLowerCase())) return false;
    const rate = c.rates?.ratePerHour ?? 0;
    if (f.minRatePerHour !== undefined && rate < f.minRatePerHour) return false;
    if (f.maxRatePerHour !== undefined && rate > f.maxRatePerHour) return false;
    return true;
  }
}
