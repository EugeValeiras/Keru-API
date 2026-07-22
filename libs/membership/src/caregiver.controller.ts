import { Body, Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard, Roles, RolesGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { RegisterCaregiverDto } from './manager/dto/register-caregiver.dto';
import { CaregiverResponseDto } from './manager/dto/caregiver-response.dto';

/** UC-02 · Perfil profesional del cuidador. Requiere cuenta con rol `caregiver`. */
@ApiTags('Caregivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('caregiver')
@Controller('caregivers')
export class CaregiverController {
  constructor(private readonly membership: MembershipManager) {}

  @Post()
  @ApiOperation({
    summary: 'UC-02 · Registrar cuidador',
    description: 'Crea el perfil profesional en estado pending. No visible en el marketplace hasta UC-19.',
  })
  @ApiCreatedResponse({ type: CaregiverResponseDto })
  async register(
    @Body() dto: RegisterCaregiverDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<CaregiverResponseDto> {
    const caregiver = await this.membership.registerCaregiver(dto, account.accountId);
    return CaregiverResponseDto.from(caregiver);
  }

  @Get('me')
  @ApiOperation({ summary: 'UC-02 · Ver mi perfil y estado de aprobación' })
  @ApiOkResponse({ type: CaregiverResponseDto })
  async myProfile(@CurrentAccount() account: AuthPrincipal): Promise<CaregiverResponseDto> {
    const caregiver = await this.membership.getMyCaregiverProfile(account.accountId);
    if (!caregiver) throw new NotFoundException('Todavía no creaste tu perfil de cuidador');
    return CaregiverResponseDto.from(caregiver);
  }
}
