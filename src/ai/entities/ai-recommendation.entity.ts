import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RecommendationType } from '../../common/enums/recommendation-type.enum';
import { Tenant } from '../../auth/entities/tenant.entity';
import { Product } from '../../inventory/entities/product.entity';

@Entity('ai_recommendations')
@Index(['pharmacyTenantId', 'isDismissed', 'createdAt'])  // active recommendations query
export class AiRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @ManyToOne(() => Tenant, { eager: false })
  @JoinColumn({ name: 'pharmacyTenantId' })
  pharmacyTenant: Tenant;

  @Column({ type: 'enum', enum: RecommendationType })
  type: RecommendationType;

  @Column({ type: 'uuid', nullable: true })
  productId: string;

  @ManyToOne(() => Product, { eager: false, nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product;

  /** Full rules-engine output — the ground truth behind the GPT explanation */
  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  /** GPT-generated plain-language explanation (or fallback template) */
  @Column({ type: 'text' })
  explanation: string;

  /** Whether the final explanation came from GPT (true) or the fallback template (false) */
  @Column({ type: 'boolean', default: false })
  explanationFromGpt: boolean;

  /** HIGH / MEDIUM / LOW — derived from RiskEngine */
  @Column({ type: 'varchar', length: 10, default: 'LOW' })
  riskLevel: string;

  /** 0.0–1.0 data-quality confidence score */
  @Column({ type: 'decimal', precision: 4, scale: 2, default: 0 })
  confidence: number;

  /** high / medium / low label for UI display */
  @Column({ type: 'varchar', length: 10, default: 'low' })
  confidenceLabel: string;

  /** Which rule types fired to produce this recommendation */
  @Column({ type: 'jsonb', default: [] })
  rulesTriggered: string[];

  @Column({ type: 'boolean', default: false })
  isDismissed: boolean;

  /**
   * Pharmacy admin feedback: 1 = helpful, -1 = not helpful, null = no feedback.
   * Used to monitor recommendation quality over time.
   */
  @Column({ type: 'int', nullable: true })
  feedbackScore: number;

  @Column({ type: 'text', nullable: true })
  feedbackNote: string;

  /**
   * Outcome tracking — closes the AI feedback loop.
   * acted_on: pharmacy placed an order for this product after the recommendation
   * ignored:  no action taken within 7 days
   * expired:  recommendation was dismissed before being acted on
   * null:     outcome not yet determined
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  outcome: 'acted_on' | 'ignored' | 'expired' | null;

  @Column({ type: 'timestamp', nullable: true })
  outcomeAt: Date;

  /** OpenAI model that generated the explanation (pinned, never an alias). NULL if rules-only fallback. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  modelVersion: string | null;

  /** System-prompt version used. Bumped whenever the prompt template changes — required for reproducibility audit. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  promptVersion: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
