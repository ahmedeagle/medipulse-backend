import { ConfigService } from '@nestjs/config';
export interface EncryptedValue {
    iv: string;
    tag: string;
    ciphertext: string;
    keyVersion: number;
}
export declare class EnvelopeEncryptionService {
    private readonly config;
    private readonly logger;
    private readonly masterKey;
    private readonly keyVersion;
    constructor(config: ConfigService);
    private deriveKey;
    encrypt(tenantId: string, plaintext: string): EncryptedValue;
    decrypt(tenantId: string, enc: EncryptedValue): string;
    serialize(enc: EncryptedValue): string;
    deserialize(raw: string): EncryptedValue;
    encryptToString(tenantId: string, plaintext: string): string;
    decryptFromString(tenantId: string, raw: string): string;
}
