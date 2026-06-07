import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentDefinition } from '../../ai-governance/entities/agent-definition.entity';

/**
 * PRD §13 Phase 4a-2 — DynamicAgent runner.
 *
 * Resolves which Arabic system prompt + version to use for a given
 * (tenant, agentCode) pair, with a clean fallback to legacy hardcoded
 * prompts when no `systemPromptAr` is set on the definition row.
 *
 * Why this exists:
 * - Lets pharmacy / platform admins iterate on prompts without a deploy.
 * - Stamps the resolved `promptVersion` ("agent:<code>@v<N>") on every
 *   audit row, so a regulator asking "why did the AI say X?" can pull the
 *   exact definition snapshot used at decision time.
 * - Tenant-scoped rows override globals, enabling per-pharmacy forks once
 *   Phase 4b ships the wizard.
 *
 * Kept intentionally tiny — no OpenAI calls here. Callers (AiService) own
 * the actual chat.completions invocation, token accounting, and guards;
 * this service only resolves the prompt context.
 */
@Injectable()
export class DynamicAgentRunner {
  private readonly logger = new Logger(DynamicAgentRunner.name);

  constructor(
    @InjectRepository(AgentDefinition)
    private readonly defs: Repository<AgentDefinition>,
  ) {}

  /**
   * Resolve the runtime prompt context for an agent.
   *
   * @returns null when no override exists (caller should use its hardcoded fallback).
   *          Concrete values when a definition row carries a `systemPromptAr`.
   */
  async resolve(
    tenantId: string,
    agentCode: string,
  ): Promise<{
    systemPrompt:  string;
    promptVersion: string;
    definitionId:  string;
    isCustom:      boolean;
  } | null> {
    // Tenant-scoped overrides win over globals (same code, different scope).
    const tenantRow = await this.defs.findOne({
      where: { code: agentCode, tenantScope: 'tenant', tenantId },
    });
    const globalRow = tenantRow
      ? null
      : await this.defs.findOne({
          where: { code: agentCode, tenantScope: 'global' },
        });

    const def = tenantRow ?? globalRow;
    if (!def || !def.systemPromptAr || def.systemPromptAr.trim() === '') {
      return null;
    }

    return {
      systemPrompt:  def.systemPromptAr,
      promptVersion: `agent:${def.code}@v${def.version}`,
      definitionId:  def.id,
      isCustom:      def.isCustom || def.tenantScope === 'tenant',
    };
  }
}
