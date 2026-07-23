import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal, CurrentAccount, JwtAuthGuard } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { AccountResponseDto } from './manager/dto/account-response.dto';
import { UpdateAccountDto } from './manager/dto/update-account.dto';

/**
 * UC-23 · Perfil de la cuenta autenticada. A diferencia de /caregivers/me, cualquier rol
 * gestiona su propia cuenta: solo pide sesión (JwtAuthGuard), sin RolesGuard.
 */
@ApiTags('Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly membership: MembershipManager) {}

  @Get('me')
  @ApiOperation({ summary: 'UC-23 · Ver mi perfil de cuenta (nombre, email, rol, foto)' })
  @ApiOkResponse({ type: AccountResponseDto })
  async myAccount(@CurrentAccount() account: AuthPrincipal): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.membership.getMyAccount(account.accountId));
  }

  @Patch('me')
  @ApiOperation({
    summary: 'UC-23 · Editar mi perfil de cuenta',
    description:
      'Set parcial de nombre y/o foto. El email (identidad de login, UC-04) no se edita por esta vía. La foto se sube antes por POST /files/images. Naturalmente idempotente (NFR-34).',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  async updateMyAccount(
    @Body() dto: UpdateAccountDto,
    @CurrentAccount() account: AuthPrincipal,
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.membership.updateMyAccount(dto, account.accountId));
  }
}
