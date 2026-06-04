import { Module, Global } from '@nestjs/common';
import { EnvelopeEncryptionService } from './envelope-encryption.service';
import { TenantIsolationSubscriber } from './tenant-isolation.subscriber';

@Global()
@Module({
  providers: [EnvelopeEncryptionService, TenantIsolationSubscriber],
  exports:   [EnvelopeEncryptionService],
})
export class SecurityModule {}
