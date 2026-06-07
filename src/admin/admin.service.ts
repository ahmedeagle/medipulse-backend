import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../auth/entities/tenant.entity';
import { User } from '../auth/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findAllTenants(
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<Tenant & { userCount: number }>> {
    const { limit, offset } = normalizePagination(pagination);
    const [tenants, total] = await this.tenantRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const data = await Promise.all(
      tenants.map(async (tenant) => {
        const userCount = await this.userRepository.count({
          where: { tenantId: tenant.id },
        });
        return { ...tenant, userCount };
      }),
    );

    return { data, total, limit, offset };
  }

  async findAllUsers(
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedResult<User>> {
    const { limit, offset } = normalizePagination(pagination);
    const [data, total] = await this.userRepository.findAndCount({
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total, limit, offset };
  }

  async createTenant(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantRepository.findOne({
      where: { slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(`A tenant with slug "${dto.slug}" already exists`);
    }

    const tenant = this.tenantRepository.create({
      name: dto.name,
      slug: dto.slug,
      type: dto.type,
      isActive: true,
    });

    return this.tenantRepository.save(tenant);
  }

  async deactivateUser(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['tenant'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.userRepository.update(id, { isActive: false });

    return this.userRepository.findOne({
      where: { id },
      relations: ['tenant'],
    });
  }
}
