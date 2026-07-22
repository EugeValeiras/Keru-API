import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { ReputationManager } from './manager/reputation.manager';
import { ReputationDto, ReviewDto, SubmitReviewDto } from './manager/dto/review.dto';

/** Reseñas bidireccionales (UC-17/21) y consulta de reputación. */
@ApiTags('Reputation')
@ApiBearerAuth()
@Controller()
export class ReviewController {
  constructor(private readonly reputation: ReputationManager) {}

  @Post('hiring-requests/:requestId/review-caregiver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('family', 'patient')
  @ApiOperation({ summary: 'UC-17 · Calificar al cuidador (servicio finalizado)' })
  @ApiCreatedResponse({ type: ReviewDto })
  async reviewCaregiver(
    @Param('requestId') requestId: string,
    @Body() dto: SubmitReviewDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<ReviewDto> {
    return ReviewDto.from(
      await this.reputation.reviewCaregiver(requestId, account.accountId, dto.rating, dto.comment),
    );
  }

  @Post('hiring-requests/:requestId/review-patient')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('caregiver')
  @ApiOperation({ summary: 'UC-21 · Calificar al paciente (servicio finalizado)' })
  @ApiCreatedResponse({ type: ReviewDto })
  async reviewPatient(
    @Param('requestId') requestId: string,
    @Body() dto: SubmitReviewDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<ReviewDto> {
    return ReviewDto.from(
      await this.reputation.reviewPatient(requestId, account.accountId, dto.rating, dto.comment),
    );
  }

  @Get('caregivers/:id/reputation')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'UC-07 · Reputación del cuidador (reseñas visibles + promedio)' })
  @ApiOkResponse({ type: ReputationDto })
  async caregiverReputation(@Param('id') id: string): Promise<ReputationDto> {
    const rep = await this.reputation.getCaregiverReputation(id);
    return { aggregate: rep.aggregate, reviews: rep.reviews.map(ReviewDto.from) };
  }

  @Get('patients/:id/reputation')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'UC-10/21 · Reputación del paciente (visible para el cuidador)' })
  @ApiOkResponse({ type: ReputationDto })
  async patientReputation(@Param('id') id: string): Promise<ReputationDto> {
    const rep = await this.reputation.getPatientReputation(id);
    return { aggregate: rep.aggregate, reviews: rep.reviews.map(ReviewDto.from) };
  }
}
