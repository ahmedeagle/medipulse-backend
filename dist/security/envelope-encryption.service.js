"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var EnvelopeEncryptionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvelopeEncryptionService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
let EnvelopeEncryptionService = EnvelopeEncryptionService_1 = class EnvelopeEncryptionService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(EnvelopeEncryptionService_1.name);
        this.keyVersion = 1;
        const masterKeyHex = config.get('ENCRYPTION_MASTER_KEY');
        if (!masterKeyHex) {
            this.logger.warn('ENCRYPTION_MASTER_KEY not set — field-level encryption disabled. ' +
                'Set a 64-char hex string in production.');
            this.masterKey = (0, crypto_1.randomBytes)(32);
        }
        else {
            this.masterKey = Buffer.from(masterKeyHex, 'hex');
            if (this.masterKey.length !== 32) {
                throw new Error('ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex chars)');
            }
        }
    }
    deriveKey(tenantId) {
        return (0, crypto_1.createHash)('sha256')
            .update(this.masterKey)
            .update(tenantId)
            .digest();
    }
    encrypt(tenantId, plaintext) {
        const key = this.deriveKey(tenantId);
        const iv = (0, crypto_1.randomBytes)(12);
        const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        return {
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex'),
            ciphertext: ciphertext.toString('hex'),
            keyVersion: this.keyVersion,
        };
    }
    decrypt(tenantId, enc) {
        const key = this.deriveKey(tenantId);
        const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', key, Buffer.from(enc.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
        return Buffer.concat([
            decipher.update(Buffer.from(enc.ciphertext, 'hex')),
            decipher.final(),
        ]).toString('utf8');
    }
    serialize(enc) {
        return JSON.stringify(enc);
    }
    deserialize(raw) {
        return JSON.parse(raw);
    }
    encryptToString(tenantId, plaintext) {
        return this.serialize(this.encrypt(tenantId, plaintext));
    }
    decryptFromString(tenantId, raw) {
        return this.decrypt(tenantId, this.deserialize(raw));
    }
};
exports.EnvelopeEncryptionService = EnvelopeEncryptionService;
exports.EnvelopeEncryptionService = EnvelopeEncryptionService = EnvelopeEncryptionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EnvelopeEncryptionService);
//# sourceMappingURL=envelope-encryption.service.js.map