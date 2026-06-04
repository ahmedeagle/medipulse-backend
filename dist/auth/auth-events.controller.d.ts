import { KeycloakEventsService } from './keycloak-events.service';
export declare class AuthEventsController {
    private readonly svc;
    constructor(svc: KeycloakEventsService);
    poll(): Promise<{
        imported: number;
    }>;
}
