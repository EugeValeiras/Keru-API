import { Injectable } from '@nestjs/common';
import { Manager, AuthPrincipal, PermissionEngine } from '@keru/core';
import { CareRecordAccess, ClinicalRecord } from '@keru/care-record';

export interface CurrentMetric {
  metricKey: string;
  value: number;
  measuredAt: Date;
}

export interface CurrentState {
  patientId: string;
  metrics: CurrentMetric[];
  asOf: string; // NFR-24: la respuesta declara su frescura
}

export interface SeriesPoint {
  measuredAt: Date;
  value: number;
}

/**
 * CareConsultManager (constitution §3.1). Camino de lectura clínica (UC-14/15). En el MVP lee el
 * store clínico directo (la proyección async / read model se difiere, constitution §4). Toda
 * respuesta declara su as-of (NFR-24). Acceso por vínculo o asignación.
 */
@Manager()
@Injectable()
export class CareConsultManager {
  constructor(
    private readonly careRecordAccess: CareRecordAccess,
    private readonly permission: PermissionEngine,
  ) {}

  /** UC-14 · Estado actual: último valor por métrica. */
  async getCurrentState(patientId: string, principal: AuthPrincipal): Promise<CurrentState> {
    await this.assertCanRead(patientId, principal);
    const records = await this.careRecordAccess.listForPatient(patientId); // orden desc por measuredAt
    const latest = new Map<string, CurrentMetric>();
    for (const r of records) {
      if (r.type !== 'vitals') continue;
      for (const v of this.values(r)) {
        if (!latest.has(v.metricKey)) {
          latest.set(v.metricKey, { metricKey: v.metricKey, value: v.value, measuredAt: r.measuredAt });
        }
      }
    }
    return { patientId, metrics: [...latest.values()], asOf: new Date().toISOString() };
  }

  /** UC-14 · Historial cronológico (vitales, medicación, novedades), por tiempo de medición. */
  async getHistory(patientId: string, principal: AuthPrincipal): Promise<ClinicalRecord[]> {
    await this.assertCanRead(patientId, principal);
    return this.careRecordAccess.listForPatient(patientId);
  }

  /** UC-15 · Serie temporal de una métrica para graficar. */
  async getSeries(patientId: string, metricKey: string, principal: AuthPrincipal): Promise<SeriesPoint[]> {
    await this.assertCanRead(patientId, principal);
    const records = await this.careRecordAccess.listForPatient(patientId);
    const points: SeriesPoint[] = [];
    for (const r of records) {
      if (r.type !== 'vitals') continue;
      for (const v of this.values(r)) {
        if (v.metricKey === metricKey) points.push({ measuredAt: r.measuredAt, value: v.value });
      }
    }
    return points.sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  }

  private values(r: ClinicalRecord): Array<{ metricKey: string; value: number }> {
    const raw = (r.data as { values?: Array<{ metricKey: string; value: number }> }).values;
    return Array.isArray(raw) ? raw : [];
  }

  /** Acceso: familiar vinculado o cuidador con asignación (fuente única: PermissionEngine). */
  private assertCanRead(patientId: string, principal: AuthPrincipal): Promise<void> {
    return this.permission.assertCanReadPatient({ accountId: principal.accountId, patientId });
  }
}
