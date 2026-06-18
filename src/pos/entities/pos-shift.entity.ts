import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('pos_shifts')
@Index(['pharmacyTenantId', 'status'])
@Index(['pharmacyTenantId', 'openedAt'])   // date-range filter + ORDER BY in listShifts
@Index(['closedAt'])                        // sparse filter on closed shifts
export class PosShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pharmacyTenantId: string;

  @Column({ type: 'uuid' })
  cashierId: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  cashierName: string;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: 'open' | 'closed';

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  openingBalance: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  closingBalance: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalSales: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalReturns: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalCashIn: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalCashOut: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalCashSales: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalCardSales: number;

  @Column({ type: 'int', default: 0 })
  transactionCount: number;

  @Column({ type: 'int', default: 0 })
  returnCount: number;

  @Column({ type: 'text', nullable: true })
  openNote: string;

  @Column({ type: 'text', nullable: true })
  closeNote: string;

  @CreateDateColumn()
  openedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date;
}
