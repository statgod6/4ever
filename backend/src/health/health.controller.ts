import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Kubernetes / Fly.io / Railway all expect two distinct probes:
 *   - liveness  (am I alive?)    → shallow; never fails unless process is wedged
 *   - readiness (can I serve?)   → deep; checks DB + required env + quota headroom
 *
 * We expose both plus the legacy /api/health for anything that was calling
 * the old endpoint. The readiness probe degrades from 200 to 503 when a
 * critical dep is down — the orchestrator then removes this instance from
 * the load balancer but does NOT restart it, giving us time to recover.
 */
@Controller()
export class HealthController {
  // Track boot time so /readyz can expose uptime for dashboards.
  private readonly bootedAt = Date.now();

  constructor(private prisma: PrismaService) {}

  /**
   * Liveness — returns 200 as long as the Node process can respond.
   * k8s / Fly.io liveness probe should hit this. Never depend on DB here,
   * otherwise a DB outage would cause the orchestrator to restart the pod
   * in a tight loop, worsening the incident.
   */
  @Get('livez')
  @HttpCode(200)
  livez() {
    return {
      status: 'ok',
      uptimeSec: Math.floor((Date.now() - this.bootedAt) / 1000),
      pid: process.pid,
    };
  }

  /**
   * Readiness — returns 200 only when we can actually serve traffic. The
   * orchestrator should point its load balancer at this endpoint and pull
   * the instance out of rotation on failure.
   *
   * Checks performed:
   *   - database: SELECT 1 round-trip (catches bad creds, network, migrations)
   *   - required secrets: presence only, never logged (catches boot with
   *     half-configured env)
   *
   * We do NOT ping OpenRouter / Twilio here because those calls are rate-
   * limited and metered \u2014 probing them every 10s would burn budget. Their
   * config is checked for *presence* only; actual dependency failures are
   * surfaced by Sentry + request-level error metrics (P4-observability).
   */
  @Get('readyz')
  async readyz() {
    const started = Date.now();
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // --- database -----------------------------------------------------------
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (err: any) {
      checks.database = {
        ok: false,
        latencyMs: Date.now() - dbStart,
        error: err?.message?.slice(0, 200) || 'unknown',
      };
    }

    // --- required config (presence check only \u2014 never log the values) -----
    const required = [
      'DATABASE_URL',
      'JWT_SECRET',
      'OPENROUTER_API_KEY',
    ];
    const missing = required.filter((k) => !process.env[k]);
    checks.config = missing.length === 0
      ? { ok: true }
      : { ok: false, error: `missing: ${missing.join(',')}` };

    // --- optional integrations \u2014 report presence for observability only ---
    const optional = {
      twilio: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
      tavily: !!process.env.TAVILY_API_KEY,
      e2b: !!process.env.E2B_API_KEY,
      corsOrigins: !!process.env.CORS_ORIGINS,
    };

    const allOk = Object.values(checks).every((c) => c.ok);
    const body = {
      status: allOk ? 'ok' : 'degraded',
      uptimeSec: Math.floor((Date.now() - this.bootedAt) / 1000),
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      env: process.env.NODE_ENV || 'development',
      checks,
      optional,
    };
  
    if (!allOk) {
      // 503 so load balancers pull us out of rotation. The orchestrator
      // keeps the process running — the liveness probe still returns 200.
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  /**
   * Legacy /api/health \u2014 preserved for any external monitor still hitting
   * the old path. Equivalent to /livez.
   */
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor((Date.now() - this.bootedAt) / 1000),
    };
  }
}
