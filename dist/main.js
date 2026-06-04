"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./telemetry");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const bullmq_1 = require("@nestjs/bullmq");
const helmet_1 = require("helmet");
const express = require("express");
const api_1 = require("@bull-board/api");
const bullMQAdapter_1 = require("@bull-board/api/bullMQAdapter");
const express_1 = require("@bull-board/express");
const app_module_1 = require("./app.module");
const ai_constants_1 = require("./ai/ai.constants");
const audit_constants_1 = require("./audit/audit.constants");
const webhook_constants_1 = require("./webhooks/webhook.constants");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const isProd = process.env.NODE_ENV === 'production';
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: isProd,
        crossOriginEmbedderPolicy: false,
    }));
    app.enableCors({
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    });
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
    }));
    app.setGlobalPrefix('api/v1');
    const boardAdapter = new express_1.ExpressAdapter();
    boardAdapter.setBasePath('/admin/queues');
    (0, api_1.createBullBoard)({
        queues: [
            new bullMQAdapter_1.BullMQAdapter(app.get((0, bullmq_1.getQueueToken)(ai_constants_1.AI_RECOMMENDATIONS_QUEUE))),
            new bullMQAdapter_1.BullMQAdapter(app.get((0, bullmq_1.getQueueToken)(audit_constants_1.AUDIT_QUEUE))),
            new bullMQAdapter_1.BullMQAdapter(app.get((0, bullmq_1.getQueueToken)(webhook_constants_1.WEBHOOK_DELIVERY_QUEUE))),
        ],
        serverAdapter: boardAdapter,
        options: { uiConfig: { boardTitle: 'MediPulse Queues' } },
    });
    const bullBoardApiKey = process.env.BULL_BOARD_API_KEY;
    app.use('/admin/queues', (req, res, next) => {
        const token = (req.headers['authorization'] ?? '').replace('Bearer ', '').trim();
        if (!bullBoardApiKey || token !== bullBoardApiKey) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }
        next();
    }, boardAdapter.getRouter());
    if (!isProd) {
        const config = new swagger_1.DocumentBuilder()
            .setTitle('MediPulse API')
            .setDescription('AI-powered pharmacy management SaaS — development only')
            .setVersion('1.0')
            .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
            .build();
        swagger_1.SwaggerModule.setup('docs', app, swagger_1.SwaggerModule.createDocument(app, config));
        console.log(`Swagger: http://localhost:${process.env.PORT || 3000}/docs`);
        console.log(`Bull Board: http://localhost:${process.env.PORT || 3000}/admin/queues  (requires BULL_BOARD_API_KEY header)`);
    }
    app.enableShutdownHooks();
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`MediPulse API running on :${port} [${process.env.NODE_ENV ?? 'development'}]`);
}
bootstrap();
//# sourceMappingURL=main.js.map