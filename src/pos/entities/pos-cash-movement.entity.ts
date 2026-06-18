import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('pos_cash_movements')
@Index(['pharmacyTenantId', 'shiftId'])
export class PosCashMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  shiftId: string;

  @Column({ type: 'varchar', length: 10 })
  type: 'in' | 'out';

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 100 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ type: 'uuid' })
  performedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
