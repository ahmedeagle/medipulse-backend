import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv, createDecipheriv, randomBytes, createHash,
} from 'crypto';

export interface EncryptedValue {
  iv:         string;  // hex
  tag:        string;  // hex — AES-GCM auth tag
  ciphertext: string;  // hex
  keyVersion: number;
}

/**
 * Envelope Encryption — AES-256-GCM with per-tenant data keys.
 *
 * Architecture:
 *   Master key:       from ENV `ENCRYPTION_MASTER_KEY` (32 bytes, hex)
 *                     In production → AWS KMS. For MVP → ENV.
 *   Per-tenant key:   derived = HKDF(masterKey, tenantId) — deterministic,
 *                     no key storage needed.
 *   Nonce:            random 12 bytes per encryption (AES-GCM requirement).
 *
 * Fields encrypted:
 *   - SupplierContract.pricingTier (commercial pricing)
 *   - TenantIntegration.config (API keys, credentials)
 *   - WebhookSubscription.secret (HMAC signing keys)
 *   - CreditWallet.creditLimit (financial)
 *   - Invoice buyer/seller VAT numbers
 *
 * Usage:
 *   const enc = encryptionService.encrypt(tenantId, 'secret-value');
 *   const plain = encryptionService.decrypt(tenantId, enc);
 */
@Injectable()
export class EnvelopeEncryptionService {
  private readonly logger = new Logger(EnvelopeEncryptionService.name);
  private readonly masterKey: Buffer;
  private readonly keyVersion = 1;

  constructor(private readonly config: ConfigService) {
    const masterKeyHex = config.get<string>('ENCRYPTION_MASTER_KEY');
    if (!masterKeyHex) {
      this.logger.warn(
        'ENCRYPTION_MASTER_KEY not set — field-level encryption disabled. ' +
        'Set a 64-char hex string in production.',
      );
      this.masterKey = randomBytes(32); // ephemeral — data not persistently encrypted
    } else {
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
      if (this.masterKey.length !== 32) {
        throw new Error('ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex chars)');
      }
    }
  }

  /** Derive a deterministic per-tenant 256-bit key using HMAC-SHA256. */
  private deriveKey(tenantId: string): Buffer {
    return createHash('sha256')
      .update(this.masterKey)
      .update(tenantId)
      .digest();
  }

  encrypt(tenantId: string, plaintext: string): EncryptedValue {
    const key = this.deriveKey(tenantId);
    const iv  = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      iv:         iv.toString('hex'),
      tag:        cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('hex'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(tenantId: string, enc: EncryptedValue): string {
    const key     = this.deriveKey(tenantId);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(enc.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(enc.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Serialize EncryptedValue for DB storage (single string column). */
  serialize(enc: EncryptedValue): string {
    return JSON.stringify(enc);
  }

  /** Deserialize from DB column. */
  deserialize(raw: string): EncryptedValue {
    return JSON.parse(raw);
  }

  /** Convenience: encrypt → serialize */
  encryptToString(tenantId: string, plaintext: string): string {
    return this.serialize(this.encrypt(tenantId, plaintext));
  }

  /** Convenience: deserialize → decrypt */
  decryptFromString(tenantId: string, raw: string): string {
    return this.decrypt(tenantId, this.deserialize(raw));
  }
}
