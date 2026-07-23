import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { METRIC_DEFINITIONS } from '../metric-definitions';
import { RangeScope, RangeVersion } from './entities/range-version.entity';

export interface ApplicableRange {
  metricKey: string;
  min: number;
  max: number;
  unit: string;
  /** Id REAL de la RangeVersion aplicada (NFR-28) — la alerta lo persiste tal cual. */
  version: string;
}

export interface RangeContext {
  /** Edad del paciente en años cumplidos al momento de la medición (estrato, NFR-17). */
  ageYears: number;
  /** Momento de la medición: la vigencia se resuelve acá (asOf = measuredAt, NFR-28/36). */
  asOf: Date;
}

export interface AppendRangeVersionInput {
  metricKey: string;
  scope: RangeScope;
  ageMinYears: number | null;
  ageMaxYears: number | null;
  min: number;
  max: number;
  unit: string;
  effectiveFrom: Date;
  authorAccountId: string | null;
  authorRole: string | null;
}

/** Años cumplidos a la fecha `at` (fechas civiles en UTC, como persiste `patient.birthDate`). */
export function ageInYearsAt(birthDate: string, at: Date): number {
  const dob = new Date(birthDate);
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const months = at.getUTCMonth() - dob.getUTCMonth();
  if (months < 0 || (months === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

/**
 * Selección determinista del estrato (NFR-17): entre las versiones vigentes cuyo estrato contiene
 * la edad, gana la más específica (más bornes etarios definidos), luego la de vigencia más
 * reciente, luego la creada más tarde y, como último desempate total, el id. El orden es una
 * función pura de los datos: el replay con el mismo asOf da siempre la misma versión (NFR-36/37).
 */
export function pickApplicableVersion(candidates: RangeVersion[], ageYears: number): RangeVersion | null {
  const specificity = (r: RangeVersion) =>
    (r.ageMinYears !== null ? 1 : 0) + (r.ageMaxYears !== null ? 1 : 0);
  const matches = candidates.filter(
    (r) =>
      (r.ageMinYears === null || ageYears >= r.ageMinYears) &&
      (r.ageMaxYears === null || ageYears < r.ageMaxYears),
  );
  matches.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.id.localeCompare(a.id),
  );
  return matches[0] ?? null;
}

/**
 * RangeAccess (constitution §3.1). Rangos clínicos versionados en DB (NFR-17/28): versiones
 * efectivo-fechadas append-only con estrato etario, resueltas con asOf = measuredAt. La escritura
 * es SOLO append (`appendVersion`); no existe verbo de UPDATE ni lo habrá. Sin endpoint público de
 * configuración: diferido por NFR-29 y la decisión abierta UC-18/NFR-18 (constitution §7). Los
 * bornes de plausibilidad (A1, error de tipeo) siguen viviendo en el catálogo (NFR-16).
 */
@ResourceAccess()
@Injectable()
export class RangeAccess {
  constructor(@InjectRepository(RangeVersion) private readonly versions: Repository<RangeVersion>) {}

  /**
   * Rango aplicable a la medición: versión system-default vigente al asOf, estrato etario del
   * paciente si existe uno más específico. Una métrica del catálogo sin versión sembrada es un
   * error de configuración del sistema — falla fuerte, nunca un fallback silencioso (NFR-28).
   */
  async getApplicableRange(metricKey: string, context: RangeContext): Promise<ApplicableRange> {
    this.def(metricKey); // métrica desconocida → 400, antes de tocar la base
    const candidates = await this.versions.find({
      where: { metricKey, scope: 'system-default', effectiveFrom: LessThanOrEqual(context.asOf) },
    });
    const version = pickApplicableVersion(candidates, context.ageYears);
    if (!version) {
      throw new InternalServerErrorException(
        `Sin versión de rango vigente para ${metricKey} al ${context.asOf.toISOString()} (¿seed faltante?)`,
      );
    }
    return { metricKey, min: version.min, max: version.max, unit: version.unit, version: version.id };
  }

  getPlausible(metricKey: string): { min: number; max: number; unit: string } {
    const def = this.def(metricKey);
    return { ...def.plausible, unit: def.unit };
  }

  /**
   * Único verbo de escritura: agrega una versión, jamás modifica una existente (append-only,
   * NFR-28). At-most-once por operationId (NFR-34): el reintento devuelve la versión ya creada.
   */
  async appendVersion(
    input: AppendRangeVersionInput,
    operationId: string,
  ): Promise<{ created: boolean; version: RangeVersion }> {
    const result = await this.versions
      .createQueryBuilder()
      .insert()
      .values({ ...input, createdByOperationId: operationId })
      .orIgnore()
      .execute();
    const version = await this.versions.findOneOrFail({ where: { createdByOperationId: operationId } });
    return { created: result.identifiers.length > 0, version };
  }

  private def(metricKey: string) {
    const def = METRIC_DEFINITIONS[metricKey];
    if (!def) throw new BadRequestException(`Métrica desconocida: ${metricKey}`);
    return def;
  }
}
