import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { ResponseCard, ChatActionButton } from '../dto/ask-chat.dto';

/**
 * chat_messages — one turn (user question or assistant answer) inside a
 * conversation. Stores the rendered cards/actions so history reopens exactly
 * as it appeared. Tenant-scoped; cards/actions kept as JSONB.
 */
@Entity('chat_messages')
@Index(['conversationId', 'createdAt'])
@Index(['tenantId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversationId: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 16 })
  role: 'user' | 'assistant';

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'jsonb', nullable: true })
  cards: ResponseCard[] | null;

  @Column({ type: 'jsonb', nullable: true })
  actions: ChatActionButton[] | null;

  /** Tool that produced an assistant answer (analytics + follow-up hints). */
  @Column({ type: 'varchar', length: 48, nullable: true })
  tool: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
