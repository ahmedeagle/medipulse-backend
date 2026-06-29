import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * chat_conversations — a single threaded conversation with المساعد التشغيلي.
 * Enables multi-turn memory + a reviewable history drawer. Tenant-scoped.
 */
@Entity('chat_conversations')
@Index(['tenantId', 'updatedAt'])
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /** Keycloak subject (user id) that owns this thread, when available. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 200, default: 'محادثة جديدة' })
  title: string;

  @Column({ type: 'int', default: 0 })
  messageCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
