import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { KeycloakAuthEvent } from '../audit/entities/keycloak-auth-event.entity';
export declare class KeycloakEventsService {
    private readonly repo;
    private readonly redis;
    private readonly config;
    private readonly logger;
    private readonly kcUrl;
    private readonly realm;
    private readonly clientId;
    private readonly secret;
    private adminToken;
    private tokenExpiry;
    constructor(repo: Repository<KeycloakAuthEvent>, redis: Redis, config: ConfigService);
    poll(): Promise<void>;
    pollEvents(): Promise<{
        imported: number;
    }>;
    private getAdminToken;
    private getLastPollTime;
    private setLastPollTime;
}
