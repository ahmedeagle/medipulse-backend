"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditDataSource = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const dotenv_1 = require("dotenv");
const path_1 = require("path");
(0, dotenv_1.config)({ path: (0, path_1.resolve)(process.cwd(), '.env') });
exports.AuditDataSource = new typeorm_1.DataSource({
    type: 'postgres',
    url: process.env.AUDIT_DATABASE_URL,
    entities: [
        'src/audit/entities/*.entity.ts',
        'src/analytics/entities/*.entity.ts',
    ],
    migrations: ['src/migrations/audit/*.ts'],
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    logging: false,
});
exports.default = exports.AuditDataSource;
//# sourceMappingURL=data-source-audit.js.map