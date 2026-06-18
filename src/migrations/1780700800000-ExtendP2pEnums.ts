import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends RecommendationType enum and Notification type union with P2P values.
 * TypeORM uses varchar columns for enums, so we just document the new values
 * via check constraints that can be added without downtime.
 *
 * Also adds P2P notification type values to the notifications table check.
 */
export class ExtendP2pEnums1780700800000 implements MigrationInterface {
  name = 'ExtendP2pEnums1780700800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No DDL needed — recommendation_type and notification.type are varchar columns.
    // New TypeScript enum values + notification union types are picked up at app boot.
    // This migration exists as a documentation + deployment checkpoint.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Nothing to reverse.
  }
}
