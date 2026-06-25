import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export interface ChangeEntry {
  field: string;
  fieldLabel: string;
  productName?: string;
  oldValue: string | null;
  newValue: string | null;
}

@Entity('purchase_invoice_changelogs')
@Index(['invoiceId', 'createdAt'])
@Index(['tenantId', 'createdAt'])
export class PurchaseInvoiceChangelog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 30 })
  action: 'created' | 'updated' | 'confirmed' | 'cancelled' | 'paid';

  @Column({ type: 'jsonb', default: '[]' })
  changes: ChangeEntry[];

  @CreateDateColumn()
  createdAt: Date;
}
