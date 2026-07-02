import express from 'express';
import { metrics, trace, SpanStatusCode } from '@opentelemetry/api';

const app = express();
const port = Number(process.env.PORT || 8080);
const meter = metrics.getMeter('telemetry-api');
const requests = meter.createCounter('kq_http_requests_total', {
  description: 'HTTP requests handled by telemetry-api',
});
const latency = meter.createHistogram('kq_http_request_duration_ms', {
  description: 'Request duration in ms',
});
const tracer = trace.getTracer('telemetry-api');

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/hello', async (req, res) => {
  const start = Date.now();
  await tracer.startActiveSpan('hello-handler', async (span) => {
    span.setAttribute('http.route', '/api/hello');
    span.setAttribute('kq.player', req.query.player || 'anonymous');
    await tracer.startActiveSpan('work', async (child) => {
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 80)));
      child.end();
    });
    requests.add(1, { route: '/api/hello', status: '200' });
    latency.record(Date.now() - start, { route: '/api/hello' });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  });
  res.json({ message: 'hello from instrumented telemetry-api', ts: new Date().toISOString() });
});

app.get('/api/boom', async (_req, res) => {
  await tracer.startActiveSpan('boom-handler', async (span) => {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'simulated failure' });
    span.recordException(new Error('simulated failure'));
    requests.add(1, { route: '/api/boom', status: '500' });
    span.end();
  });
  res.status(500).json({ error: 'simulated failure for tracing labs' });
});

app.listen(port, () => console.log(`telemetry-api on :${port}`));
