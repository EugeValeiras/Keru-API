import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { HiringManager } from '@keru/hiring';
import { ReputationManager } from '@keru/reputation';

/** Ops / back-office: correr los barridos de vencidos manualmente (NFR-14). Requiere rol admin. */
@ApiTags('Ops')
@SkipThrottle() // interno (KER-14): ya exige JWT + rol admin
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/ops')
export class OpsController {
  constructor(
    private readonly hiring: HiringManager,
    private readonly reputation: ReputationManager,
  ) {}

  @Post('sweep')
  @ApiOperation({ summary: 'NFR-14 · Ejecutar el barrido de vencidos ahora (asignaciones, solicitudes, reseñas)' })
  @ApiOkResponse({ description: 'Cantidades transicionadas' })
  async sweep() {
    const lifecycle = await this.hiring.sweepLifecycle();
    const reviews = await this.reputation.sweepReviewWindows();
    return { ...lifecycle, ...reviews };
  }
}
