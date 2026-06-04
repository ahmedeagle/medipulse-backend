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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthEventsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const keycloak_events_service_1 = require("./keycloak-events.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const role_enum_1 = require("../common/enums/role.enum");
let AuthEventsController = class AuthEventsController {
    constructor(svc) {
        this.svc = svc;
    }
    poll() {
        return this.svc.pollEvents();
    }
};
exports.AuthEventsController = AuthEventsController;
__decorate([
    (0, common_1.Post)('poll'),
    (0, swagger_1.ApiOperation)({
        summary: 'Manually trigger Keycloak event poll (system admin)',
        description: 'Normally runs automatically every 5 minutes. ' +
            'Use this to force an immediate sync, e.g. after initial setup.',
    }),
    (0, swagger_1.ApiOkResponse)({ description: '{ imported: number }' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuthEventsController.prototype, "poll", null);
exports.AuthEventsController = AuthEventsController = __decorate([
    (0, swagger_1.ApiTags)('audit'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(role_enum_1.Role.SYSTEM_ADMIN),
    (0, common_1.Controller)('admin/kc-events'),
    __metadata("design:paramtypes", [keycloak_events_service_1.KeycloakEventsService])
], AuthEventsController);
//# sourceMappingURL=auth-events.controller.js.map