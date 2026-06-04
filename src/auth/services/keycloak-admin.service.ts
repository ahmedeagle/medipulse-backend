import {
  Injectable,
  Logger,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Role } from '../../common/enums/role.enum';

interface KcUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  attributes?: Record<string, string[]>;
}

/**
 * Thin wrapper around the Keycloak Admin REST API.
 *
 * Uses client_credentials grant (service account on medipulse-api client).
 * Token is cached for 55s (KC default access token = 60s) to avoid
 * hammering the token endpoint on every request.
 *
 * Swap note: all KC Admin calls are isolated here — if we migrate to
 * @keycloak/keycloak-admin-client, only this file changes.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private readonly http: AxiosInstance;
  private readonly kcUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {
    this.kcUrl = config.get<string>('KC_URL');
    this.realm = config.get<string>('KC_REALM');
    this.clientId = config.get<string>('KC_CLIENT_ID');
    this.clientSecret = config.get<string>('KC_CLIENT_SECRET');

    this.http = axios.create({ baseURL: `${this.kcUrl}/admin/realms/${this.realm}` });
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  async createUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    tenantId: string;
  }): Promise<string> {
    const token = await this.getAdminToken();

    const kcRoleName = this.toKcRoleName(params.role);

    try {
      // 1. Create user
      const response = await this.http.post(
        '/users',
        {
          email: params.email,
          firstName: params.firstName,
          lastName: params.lastName,
          enabled: true,
          emailVerified: false,
          attributes: { tenantId: [params.tenantId] },
          requiredActions: ['UPDATE_PASSWORD', 'VERIFY_EMAIL'],
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      // KC returns the new user ID in the Location header
      const location: string = response.headers['location'] ?? '';
      const kcId = location.split('/').pop();

      if (!kcId) {
        throw new InternalServerErrorException('KC did not return a user ID');
      }

      // 2. Assign realm role
      await this.assignRealmRole(kcId, kcRoleName, token);

      // 3. Send welcome/verify email
      await this.sendVerificationEmail(kcId, token);

      this.logger.log(`KC user created: ${kcId} (${params.email}) role=${kcRoleName}`);
      return kcId;
    } catch (error) {
      if (error.response?.status === 409) {
        throw new ConflictException(
          `A Keycloak user with email ${params.email} already exists`,
        );
      }
      this.logger.error(`KC createUser failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create user in Keycloak');
    }
  }

  async deactivateUser(kcId: string): Promise<void> {
    const token = await this.getAdminToken();
    await this.http.put(
      `/users/${kcId}`,
      { enabled: false },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }

  async deleteUser(kcId: string): Promise<void> {
    const token = await this.getAdminToken();
    await this.http.delete(`/users/${kcId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async updateUserAttribute(kcId: string, key: string, value: string): Promise<void> {
    const token = await this.getAdminToken();
    const { data: existing } = await this.http.get<KcUser>(`/users/${kcId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const attributes = { ...(existing.attributes ?? {}), [key]: [value] };
    await this.http.put(
      `/users/${kcId}`,
      { attributes },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }

  // ─── Roles ────────────────────────────────────────────────────────────────

  private async assignRealmRole(kcId: string, roleName: string, token: string): Promise<void> {
    // Get role representation first
    const { data: role } = await this.http.get(`/roles/${roleName}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await this.http.post(
      `/users/${kcId}/role-mappings/realm`,
      [role],
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }

  // ─── Email ────────────────────────────────────────────────────────────────

  private async sendVerificationEmail(kcId: string, token: string): Promise<void> {
    try {
      await this.http.put(
        `/users/${kcId}/send-verify-email`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (error) {
      // Non-fatal — user can still log in, just email unverified
      this.logger.warn(`KC send-verify-email failed for ${kcId}: ${error.message}`);
    }
  }

  // ─── Token management ─────────────────────────────────────────────────────

  private async getAdminToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const { data } = await axios.post(
      `${this.kcUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    this.cachedToken = data.access_token;
    // Cache for 55s (token lifetime is 60s by default)
    this.tokenExpiresAt = Date.now() + 55_000;

    return this.cachedToken;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private toKcRoleName(role: Role): string {
    const map: Record<Role, string> = {
      [Role.PHARMACY_ADMIN]: 'pharmacy-admin',
      [Role.SUPPLIER_ADMIN]: 'supplier-admin',
      [Role.SYSTEM_ADMIN]:   'system-admin',
      [Role.CHAIN_ADMIN]:    'chain-admin',
    };
    return map[role];
  }
}
