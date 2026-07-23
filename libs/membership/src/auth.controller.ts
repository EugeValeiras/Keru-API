import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AllowPendingPassword,
  AuthPrincipal,
  CurrentAccount,
  JwtAuthGuard,
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
} from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import {
  AuthResponseDto,
  LoginDto,
  LogoutDto,
  LogoutResponseDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  PasswordResetRequestResponseDto,
  SetPasswordDto,
  SignupDto,
  StepUpDto,
  StepUpResponseDto,
} from './manager/dto/auth.dto';

/**
 * UC-04 · Autenticación. signup/login públicos (sin guard); logout y step-up exigen sesión
 * (KER-38, NFR-33/41). Cuota estricta anti fuerza bruta en todos (KER-14): step-up re-verifica
 * password, así que hereda el mismo throttle que login.
 */
@ApiTags('Auth')
@Throttle({ default: { limit: THROTTLE_LIMITS.auth, ttl: THROTTLE_TTL_MS } })
@Controller('auth')
export class AuthController {
  constructor(private readonly membership: MembershipManager) {}

  @Post('signup')
  @ApiOperation({ summary: 'UC-04 · Crear cuenta y obtener token' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  signup(@Body() dto: SignupDto): Promise<AuthResponseDto> {
    return this.membership.signup(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'UC-04 · Iniciar sesión' })
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.membership.login(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'UC-04 · Cerrar sesión: revoca el token (denylist jti) y las push de la sesión (NFR-41)' })
  @ApiOkResponse({ type: LogoutResponseDto })
  async logout(
    @CurrentAccount() account: AuthPrincipal,
    @Body() dto: LogoutDto,
  ): Promise<LogoutResponseDto> {
    await this.membership.logout(account, dto.pushEndpoint);
    return { ok: true };
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'UC-04 A4 · Pedir reset de contraseña: responde SIEMPRE 200 (anti-enumeración)',
  })
  @ApiOkResponse({ type: PasswordResetRequestResponseDto })
  async requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
  ): Promise<PasswordResetRequestResponseDto> {
    await this.membership.requestPasswordReset(dto.email);
    return { ok: true };
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'UC-04 A4 · Confirmar reset: setea la contraseña nueva, revoca sesiones vigentes y auto-loguea (410 si el token es inválido/expirado/usado)',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  confirmPasswordReset(@Body() dto: PasswordResetConfirmDto): Promise<AuthResponseDto> {
    return this.membership.confirmPasswordReset(dto);
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @AllowPendingPassword()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'UC-04 A5 · Primer acceso: definir la contraseña (sesión limitada MUST_SET_PASSWORD). Auto-loguea con sesión completa; 409 si la cuenta ya tiene contraseña',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  setPassword(
    @CurrentAccount() account: AuthPrincipal,
    @Body() dto: SetPasswordDto,
  ): Promise<AuthResponseDto> {
    return this.membership.setFirstLoginPassword(account, dto.newPassword);
  }

  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'UC-04 A3 · Re-confirmar password: emite token corto step_up para operaciones sensibles (NFR-33)' })
  @ApiOkResponse({ type: StepUpResponseDto })
  stepUp(
    @CurrentAccount() account: AuthPrincipal,
    @Body() dto: StepUpDto,
  ): Promise<StepUpResponseDto> {
    return this.membership.stepUp(account, dto.password);
  }
}
