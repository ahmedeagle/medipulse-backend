"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditRead = exports.AUDIT_READ_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.AUDIT_READ_KEY = 'audit:read:resource';
const AuditRead = (resource) => (0, common_1.SetMetadata)(exports.AUDIT_READ_KEY, resource);
exports.AuditRead = AuditRead;
//# sourceMappingURL=audit-read.decorator.js.map