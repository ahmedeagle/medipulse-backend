import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('pos_customers')
@Index(['pharmacyTenantId', 'phone'])
@Index(['pharmacyTenantId'])
export class PosCustomer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: 'male' | 'female' | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalPurchases: number;

  @Column({ type: 'int', default: 0 })
  visitCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastVisitAt: Date;

  @Column({ type: 'uuid', nullable: true })
  insuranceCompanyId: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  insuranceCardNumber: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  insurancePolicyNumber: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  copayPercent: number | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  deletedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
