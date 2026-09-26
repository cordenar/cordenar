import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import otelResources from '@opentelemetry/resources';
import { insertToolCalls } from './db.js';

const { resourceFromAttributes } = otelResources;

let provider, tracer;

class SqliteSpanExporter {
  export(spans, resultCallback) {
    if (!spans || spans.length === 0) {
      return resultCallback({ code: 0 });
    }

    const rows = [];
    for (const span of spans) {
      const calledAt = Math.round(span.startTime[0] + span.startTime[1] / 1e9);

      rows.push({
        tool: span.name,
        error_type: span.attributes['error.type'] ?? null,
        called_at: calledAt,
        deployment_env: span.resource.attributes['deployment.environment.name'] ?? 'production',
      });
    }

    try {
      insertToolCalls(rows);
      resultCallback({ code: 0 });
    } catch (err) {
      console.error(`[cordenar] SqliteSpanExporter failed: ${err.message}`);
      resultCallback({ code: 1 });
    }
  }

  shutdown() {
    return Promise.resolve();
  }
}

export function initTelemetry(db, version) {
  if (provider) return tracer;

  const resource = resourceFromAttributes({
    'service.name': 'Cordenar',
    'service.version': version,
    'deployment.environment.name': process.env.CORDENAR_ENV || 'production',
  });

  const exporter = new SqliteSpanExporter(db);

  provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  trace.setGlobalTracerProvider(provider);

  tracer = trace.getTracer('Cordenar', version);

  return tracer;
}

export function getTracer() {
  return tracer;
}

export async function forceFlushTelemetry() {
  if (provider) {
    try {
      await provider.forceFlush();
    } catch (err) {
      console.error(`[cordenar] forceFlush failed: ${err.message}`);
    }
  }
}

export { SpanKind, SpanStatusCode };
