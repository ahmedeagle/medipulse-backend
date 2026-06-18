import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, OneToMany } from 'typeorm';

@Entity('pos_transactions')
@Index(['pharmacyTenantId', 'createdAt'])
@Index(['pharmacyTenantId', 'shiftId'])
@Index(['pharmacyTenantId', 'customerId'])
export class PosTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  shiftId: string;

  @Column({ type: 'uuid' })
  cashierId: string;

  @Column({ type: 'uuid', nullable: true })
  customerId: string;

  @Column({ type: 'varchar', length: 10, default: 'sale' })
  type: 'sale' | 'return';

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalAmount: number;

  @Column({ type: 'varchar', length: 20, default: 'cash' })
  paymentMethod: 'cash' | 'card' | 'split';

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cashAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cardAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  changeAmount: number;

  @Column({ type: 'varchar', length: 20, default: 'completed' })
  status: 'completed' | 'voided';

  @Column({ type: 'uuid', nullable: true })
  voidedByUserId: string;

  @Column({ type: 'timestamp', nullable: true })
  voidedAt: Date;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany('PosTransactionItem', 'transaction', { eager: true, cascade: ['insert'] })
  items: any[];
}
