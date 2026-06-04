if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
    const sdk = new NodeSDK({
        resource: new Resource({
            [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'medipulse-api',
            [SEMRESATTRS_SERVICE_VERSION]: '1.5.0',
        }),
        traceExporter: new OTLPTraceExporter({
            url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        }),
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': { enabled: false },
            }),
        ],
    });
    sdk.start();
    console.log(`[OTel] Tracing enabled → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`);
    process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
}
else {
}
//# sourceMappingURL=telemetry.js.map