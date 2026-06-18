import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('missed_demand_entries')
@Index(['tenantId'])
@Index(['createdAt'])
export class MissedDemandEntry {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() tenantId: string;

  @Column({ nullable: true }) productId: string | null;

  @Column({ length: 255, nullable: true }) productName: string | null;

  @Column({ type: 'int', default: 1 }) quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  estimatedLostEgp: number | null;

  /** 'pos_manual' | 'inventory_search' */
  @Column({ length: 50, default: 'pos_manual' }) source: string;

  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
