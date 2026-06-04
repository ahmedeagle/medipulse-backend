"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./telemetry");
const core_1 = require("@nestjs/core");
const worker_app_module_1 = require("./worker-app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(worker_app_module_1.WorkerAppModule, {
        logger: ['error', 'warn', 'log'],
    });
    app.setGlobalPrefix('api/v1');
    app.enableShutdownHooks();
    const port = process.env.WORKER_PORT ?? 3001;
    await app.listen(port);
    console.log(`MediPulse Worker running on :${port} [${process.env.NODE_ENV ?? 'development'}]`);
}
bootstrap();
//# sourceMappingURL=worker.js.map