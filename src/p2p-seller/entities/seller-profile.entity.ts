import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type SellerVerificationStatus = 'pending' | 'verified' | 'rejected';

export interface DeliveryZone {
  radiusKm: 3 | 5 | 10;
  price: number;
  isFree: boolean;
}

@Entity('seller_profiles')
@Index(['pharmacyTenantId'], { unique: true })
@Index(['verificationStatus'])
@Index(['city'])
export class SellerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  pharmacyTenantId: string;

  @Column({ type: 'varchar', length: 255 })
  legalName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  gpsLocation: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  // ── Contact channels (shown to the counterparty on every P2P order) ──
  /** Pharmacy contact phone (E.164). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string;

  /** Pharmacy contact email — invoices, dispute trail, escalations. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  /**
   * WhatsApp number (E.164, e.g. "+201234567890").
   * Fast-channel for buyer/seller delivery coordination once an order is
   * accepted — far higher response rate than email in MENA pharma.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  whatsapp: string;

  @Column({ type: 'text', nullable: true })
  pharmacyLicenseUrl: string;

  @Column({ type: 'text', nullable: true })
  commercialRegUrl: string;

  @Column({ type: 'text', nullable: true })
  taxDocUrl: string;

  @Column({ type: 'text', nullable: true })
  pharmacistLicenseUrl: string;

  @Column({ type: 'text', nullable: true })
  licenseHolderIdUrl: string;

  @Column({ type: 'text', nullable: true })
  municipalPermitUrl: string;

  @Column({ type: 'text', nullable: true })
  vatCertUrl: string;

  @Column({ type: 'jsonb', default: [] })
  deliveryZones: DeliveryZone[];

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string;

  @Column({ type: 'jsonb', default: {} })
  automations: {
    autoListNearExpiry?: boolean;
    autoUpdateDiscounts?: boolean;
    autoDownloadInvoice?: boolean;
    autoProcurement?: boolean;
  };

  @Column({ type: 'jsonb', default: {} })
  notificationPrefs: {
    newOrders?: boolean;
    orderActivity?: boolean;
    autoListings?: boolean;
    priceAlerts?: boolean;
    expiryWarnings?: boolean;
    aiRecommendations?: boolean;
  };

  @Column({ type: 'boolean', default: true })
  isVisible: boolean;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  verificationStatus: SellerVerificationStatus;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  /** Tracks 90-day legal compliance re-ack cycle */
  @Column({ type: 'timestamp', nullable: true })
  lastLegalAckAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
