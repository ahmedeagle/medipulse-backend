import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * Immutable record of Keycloak authentication and admin events.
 * Stored in the dedicated audit DB (append-only).
 *
 * KC event types captured:
 *   LOGIN, LOGOUT, LOGIN_ERROR, REGISTER, UPDATE_PASSWORD,
 *   RESET_PASSWORD, SEND_VERIFY_EMAIL, UPDATE_EMAIL, REVOKE_GRANT,
 *   CLIENT_LOGIN, TOKEN_EXCHANGE
 *
 * Polled from KC Admin API every 5 minutes by KeycloakEventsService.
 * Requires 'view-events' role on the medipulse-api service account.
 */
@Entity('keycloak_auth_events')
@Index(['eventType', 'time'])
@Index(['kcUserId', 'time'])
@Index(['tenantId', 'time'])
@Index(['sessionId'])
export class KeycloakAuthEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** KC's own event ID — used to prevent duplicate inserts */
  @Column({ type: 'varchar', length: 100, unique: true })
  kcEventId: string;

  /** LOGIN | LOGOUT | LOGIN_ERROR | REGISTER | UPDATE_PASSWORD | etc. */
  @Column({ type: 'varchar', length: 60 })
  eventType: string;

  /** KC user sub (UUID) */
  @Column({ type: 'varchar', length: 36, nullable: true })
  kcUserId: string;

  /** tenantId from user's KC attribute — null if not yet set (e.g. pre-onboarding) */
  @Column({ type: 'uuid', nullable: true })
  tenantId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sessionId: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  /** KC client that triggered the event, e.g. "medipulse-spa" */
  @Column({ type: 'varchar', length: 100, nullable: true })
  clientId: string;

  /** Event-specific details (error codes, redirect URIs, etc.) */
  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any>;

  /** KC event timestamp (milliseconds epoch) */
  @Column({ type: 'bigint' })
  time: number;
}
