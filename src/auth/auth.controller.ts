import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Onboard a new pharmacy or supplier.
   * System admin calls this — Keycloak sends the user a "set password" email.
   * No login endpoint here — authentication is fully handled by Keycloak OIDC.
   */
  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Onboard a new pharmacy or supplier (system_admin only)',
    description:
      'Creates a Keycloak user + local tenant record. KC sends a password-setup email to the new user. No password is ever handled by this API.',
  })
  @ApiCreatedResponse({ description: 'User created in KC + DB. Password email sent.' })
  @ApiConflictResponse({ description: 'Email already exists' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Returns the current user profile, synced from KC token claims.
   * Also serves as the lazy profile-creation trigger on first login.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get current user profile (synced from Keycloak)',
    description: 'Validates the Bearer token, upserts local profile from KC claims, returns user + tenant.',
  })
  @ApiOkResponse({ description: 'User profile with tenant' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired token' })
  getMe(@CurrentUser() user: any) {
    return this.authService.syncProfile(user);
  }
}
