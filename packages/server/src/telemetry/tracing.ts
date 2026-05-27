import { NodeSDK } from "@opentelemetry/sdk-node";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: "a-workbench",
  [SemanticResourceAttributes.SERVICE_VERSION]: "0.1.0",
});

const provider = new NodeTracerProvider({ resource });
provider.register();

registerInstrumentations({
  instrumentations: [new HttpInstrumentation()],
});

const sdk = new NodeSDK({ resource, traceExporter: undefined });
sdk.start();

export const tracer = trace.getTracer("a-workbench");

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) {
        span.setAttribute(k, v);
      }
    }
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err });
      span.recordException(err);
      throw e;
    } finally {
      span.end();
    }
  });
}
