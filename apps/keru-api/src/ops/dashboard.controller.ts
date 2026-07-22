import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { MembershipManager } from '@keru/membership';
import { HiringManager } from '@keru/hiring';

/** Dashboard operativo del back-office: métricas agregadas. Requiere rol admin. */
@ApiTags('Ops')
@SkipThrottle() // interno (KER-14): ya exige JWT + rol admin
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/dashboard')
export class DashboardController {
  constructor(
    private readonly membership: MembershipManager,
    private readonly hiring: HiringManager,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Métricas operativas (cuidadores por estado, contrataciones, asignaciones activas)' })
  @ApiOkResponse({ description: 'Métricas del back-office' })
  async get() {
    const [caregivers, hiring] = await Promise.all([
      this.membership.caregiverCountsByStatus(),
      this.hiring.dashboardMetrics(),
    ]);
    return {
      caregivers,
      requests: hiring.requests,
      activeAssignments: hiring.activeAssignments,
    };
  }
}
