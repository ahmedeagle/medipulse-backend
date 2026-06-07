import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentDefinition } from './entities/agent-definition.entity';
import { AgentTenantSetting } from './entities/agent-tenant-setting.entity';

export interface AgentView {
  code: string;
  nameEn: string;
  nameAr: string;
  category: string;
  descriptionEn: string;
  descriptionAr: string;
  skills: string[];
  permissions: string[];
  restrictions: string[];
  outputTypes: string[];
  phase: number;
  iconKey: string;
  /** Effective enabled = setting override ?? definition.defaultEnabled */
  enabled: boolean;
  /** Effective minConfidence (0.00 - 1.00) */
  minConfidence: number;
  /** True when the row in agent_tenant_settings exists (i.e. user customised). */
  customised: boolean;
}

@Injectable()
export class AgentService {
  constructor(
    @InjectRepository(AgentDefinition)    private readonly defs: Repository<AgentDefinition>,
    @InjectRepository(AgentTenantSetting) private readonly settings: Repository<AgentTenantSetting>,
  ) {}

  /** All agents merged with the tenant's overrides — drives the Agents tab. */
  async listForTenant(tenantId: string): Promise<AgentView[]> {
    const [defs, settings] = await Promise.all([
      this.defs.find({ order: { phase: 'ASC', code: 'ASC' } }),
      this.settings.find({ where: { tenantId } }),
    ]);
    const byCode = new Map(settings.map((s) => [s.agentCode, s]));
    return defs.map((d) => {
      const s = byCode.get(d.code);
      return {
        code:          d.code,
        nameEn:        d.nameEn,
        nameAr:        d.nameAr,
        category:      d.category,
        descriptionEn: d.descriptionEn,
        descriptionAr: d.descriptionAr,
        skills:        d.skills ?? [],
        permissions:   d.permissions ?? [],
        restrictions:  d.restrictions ?? [],
        outputTypes:   d.outputTypes ?? [],
        phase:         d.phase,
        iconKey:       d.iconKey,
        enabled:       s?.enabled ?? d.defaultEnabled,
        minConfidence: Number(s?.minConfidence ?? d.minConfidence),
        customised:    !!s,
      };
    });
  }

  async getDefinition(code: string): Promise<AgentDefinition> {
    const def = await this.defs.findOne({ where: { code } });
    if (!def) throw new NotFoundException(`Agent ${code} not found`);
    return def;
  }

  /**
   * Upsert per-tenant override. Pass `minConfidence=null` to reset to the
   * AgentDefinition default; the row stays so we keep the override history.
   */
  async setTenantSetting(
    tenantId: string,
    code: string,
    patch: { enabled?: boolean; minConfidence?: number | null },
    actorUserId: string | null,
  ): Promise<AgentTenantSetting> {
    await this.getDefinition(code);
    let row = await this.settings.findOne({ where: { tenantId, agentCode: code } });
    if (!row) {
      row = this.settings.create({
        tenantId,
        agentCode: code,
        enabled:   patch.enabled ?? true,
        minConfidence: patch.minConfidence ?? null,
        updatedByUserId: actorUserId,
      });
    } else {
      if (patch.enabled !== undefined) row.enabled = patch.enabled;
      if (patch.minConfidence !== undefined) row.minConfidence = patch.minConfidence;
      row.updatedByUserId = actorUserId;
    }
    return this.settings.save(row);
  }

  // ── PRD §13: Custom Agents Foundation (Phase 4a-1) ───────────────────

  /**
   * Resolve the AgentDefinition that applies for a given tenant + code.
   * Tenant-scoped overrides take precedence over global built-ins, so a
   * pharmacy can fork a built-in by creating a tenant row with the same code.
   */
  async resolveDefinition(tenantId: string, code: string): Promise<AgentDefinition> {
    const tenantRow = await this.defs.findOne({
      where: { code, tenantScope: 'tenant', tenantId },
    });
    if (tenantRow) return tenantRow;
    const globalRow = await this.defs.findOne({
      where: { code, tenantScope: 'global' },
    });
    if (!globalRow) throw new NotFoundException(`Agent ${code} not found`);
    return globalRow;
  }

  /** Full definition (incl. prompt + schema) for the Agents-tab "edit" drawer. */
  async getDefinitionForTenant(tenantId: string, code: string): Promise<AgentDefinition> {
    return this.resolveDefinition(tenantId, code);
  }

  /**
   * Edit an agent's Arabic system prompt. Bumps `version` so audit rows
   * stamped with the prior version remain reproducible.
   *
   * Built-in (global) prompts can only be edited by platform admins — this
   * service trusts the controller to enforce the role; we still refuse here
   * if the caller's tenantId doesn't match a tenant-scoped row.
   */
  async updatePrompt(
    tenantId: string,
    code: string,
    patch: { systemPromptAr?: string | null; outputSchema?: Record<string, any> },
    actorUserId: string,
    isPlatformAdmin: boolean,
  ): Promise<AgentDefinition> {
    const def = await this.resolveDefinition(tenantId, code);

    if (def.tenantScope === 'global' && !isPlatformAdmin) {
      throw new ForbiddenException(
        'Editing built-in agent prompts requires platform admin. Create a tenant copy instead.',
      );
    }
    if (def.tenantScope === 'tenant' && def.tenantId !== tenantId) {
      throw new ForbiddenException('Cannot edit another tenant\'s agent definition');
    }

    if (patch.systemPromptAr !== undefined) def.systemPromptAr = patch.systemPromptAr;
    if (patch.outputSchema   !== undefined) def.outputSchema   = patch.outputSchema;

    def.version          = def.version + 1;
    def.createdByUserId  = actorUserId;

    return this.defs.save(def);
  }
}
