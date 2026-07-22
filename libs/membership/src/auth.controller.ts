import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LIMITS, THROTTLE_TTL_MS } from '@keru/core';
import { MembershipManager } from './manager/membership.manager';
import { AuthResponseDto, LoginDto, SignupDto } from './manager/dto/auth.dto';

/** UC-04 · Autenticación. Endpoints públicos (sin guard); cuota estricta anti fuerza bruta (KER-14). */
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
}
