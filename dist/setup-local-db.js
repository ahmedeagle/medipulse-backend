"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const dotenv_1 = require("dotenv");
const path_1 = require("path");
(0, dotenv_1.config)({ path: (0, path_1.resolve)(process.cwd(), '.env') });
async function setupLocalDb() {
    console.log('Setting up local database (synchronize:true — local only)...');
    const mainDb = new typeorm_1.DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: ['src/**/*.entity.ts'],
        synchronize: true,
        logging: true,
    });
    const auditDb = new typeorm_1.DataSource({
        type: 'postgres',
        url: process.env.AUDIT_DATABASE_URL,
        entities: [
            'src/audit/entities/*.entity.ts',
            'src/analytics/entities/*.entity.ts',
        ],
        synchronize: true,
        logging: true,
    });
    await mainDb.initialize();
    console.log('✅ Main DB tables created');
    await mainDb.destroy();
    await auditDb.initialize();
    console.log('✅ Audit DB tables created');
    await auditDb.destroy();
    console.log('\n✅ Local database setup complete.');
    console.log('You can now run: npm run start:dev');
    process.exit(0);
}
setupLocalDb().catch((err) => {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
});
//# sourceMappingURL=setup-local-db.js.map