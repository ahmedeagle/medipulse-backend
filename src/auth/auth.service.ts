import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Tenant } from './entities/tenant.entity';
import { RegisterDto } from './dto/register.dto';
import { Role } from '../common/enums/role.enum';
import { TenantType } from '../common/enums/tenant-type.enum';
import { KeycloakAdminService } from './services/keycloak-admin.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    private readonly kcAdmin: KeycloakAdminService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Onboard a new pharmacy or supplier.
   * Called by system_admin only.
   *
   * Flow:
   * 1. Create Tenant + local User record in a single transaction
   * 2. Create Keycloak user with correct role + tenantId attribute
   * 3. KC sends a "Set password + verify email" link to the user
   *
   * If KC call fails the DB transaction is rolled back → no orphaned records.
   */
  async register(dto: RegisterDto): Promise<{ user: Partial<User>; message: string }> {
    const existingUser = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException(`A user with email ${dto.email} already exists`);
    }

    const role = dto.tenantType === TenantType.PHARMACY
      ? Role.PHARMACY_ADMIN
      : Role.SUPPLIER_ADMIN;

    const slug = this.toSlug(dto.tenantName);
    const existingSlug = await this.tenantRepo.findOne({ where: { slug } });
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let kcId: string | null = null;

    try {
      // 1. Create Tenant
      const tenant = qr.manager.create(Tenant, {
        name: dto.tenantName,
        slug: finalSlug,
        type: dto.tenantType,
        isActive: true,
      });
      const savedTenant = await qr.manager.save(Tenant, tenant);

      // 2. Create local User (placeholder kcId — filled after KC call)
      const user = qr.manager.create(User, {
        kcId: 'pending',
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role,
        isActive: true,
        tenantId: savedTenant.id,
      });
      const savedUser = await qr.manager.save(User, user);

      // 3. Create KC user (may throw ConflictException / InternalServerErrorException)
      kcId = await this.kcAdmin.createUser({
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role,
        tenantId: savedTenant.id,
      });

      // 4. Back-fill real kcId
      await qr.manager.update(User, savedUser.id, { kcId });

      await qr.commitTransaction();

      this.logger.log(`Registered: ${dto.email} tenant=${savedTenant.id} kc=${kcId}`);

      const { passwordHash: _pw, ...safe } = savedUser as any;
      return {
        user: { ...safe, kcId },
        message: `User created. A password setup email has been sent to ${dto.email}.`,
      };
    } catch (err) {
      await qr.rollbackTransaction();

      // If DB rolled back but KC user was already created, clean it up
      if (kcId) {
        try {
          await this.kcAdmin.deleteUser(kcId);
          this.logger.warn(`Rolled back KC user ${kcId} after DB failure`);
        } catch (cleanupErr) {
          this.logger.error(`KC cleanup failed for ${kcId}: ${cleanupErr.message}`);
        }
      }

      throw err;
    } finally {
      await qr.release();
    }
  }

  /**
   * Upserts the local User profile from KC token claims.
   * Called lazily on GET /auth/me — keeps the local record in sync
   * with KC without requiring a separate sync job.
   */
  async syncProfile(kcClaims: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    tenantId: string;
  }): Promise<User> {
    let user = await this.userRepo.findOne({ where: { kcId: kcClaims.id } });

    if (!user) {
      // First time this KC user hits our API — create local profile
      user = this.userRepo.create({
        kcId: kcClaims.id,
        email: kcClaims.email,
        firstName: kcClaims.firstName,
        lastName: kcClaims.lastName,
        role: kcClaims.role,
        isActive: true,
        tenantId: kcClaims.tenantId,
      });
      user = await this.userRepo.save(user);
      this.logger.log(`Auto-created local profile for KC user ${kcClaims.id}`);
    } else {
      // Sync mutable fields that may have changed in KC
      await this.userRepo.update(user.id, {
        email: kcClaims.email,
        firstName: kcClaims.firstName,
        lastName: kcClaims.lastName,
        role: kcClaims.role,
      });
      user = { ...user, ...kcClaims, id: user.id };
    }

    return this.userRepo.findOne({
      where: { id: user.id },
      relations: ['tenant'],
    });
  }

  async getProfile(kcId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { kcId },
      relations: ['tenant'],
    });
    if (!user) throw new NotFoundException('User profile not found');
    return user;
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
