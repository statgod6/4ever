// k6 load test for 4Ever production API
//
// Purpose: validate that quotas + throttles hold under 50 concurrent LLM
// streams without OOM, p95 > 3s on reads, or 5xx burst.
//
// Prereq:
//   1. Install k6: https://k6.io/docs/getting-started/installation/
//   2. Provision 10 test accounts in production (create via OTP to Twilio
//      test credentials, then capture the returned JWTs into a file).
//   3. Save JWTs one-per-line at: tests/loadtest/jwts.txt (gitignored).
//
// Run:
//   k6 run --env BASE=https://api.4ever.app/api \
//          --env JWT_FILE=jwts.txt \
//          tests/loadtest/smoke.js
//
// Stages:
//   - ramp to 50 VUs over 2 min
//   - hold 50 VUs for 5 min
//   - ramp down over 1 min
//
// Thresholds (will fail the run if breached):
//   - p95 latency for /users/me < 500ms
//   - p95 latency for /personas < 800ms
//   - http_req_failed < 1%
//   - 429 rate < 5% of total (some 429s are expected — we WANT throttling
//     to engage at these volumes)

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'
import { SharedArray } from 'k6/data'

const jwts = new SharedArray('jwts', function () {
  const file = open(__ENV.JWT_FILE || './jwts.txt')
  return file.split('\n').map((l) => l.trim()).filter(Boolean)
})

const BASE = __ENV.BASE || 'http://localhost:3001/api'

const rate429 = new Rate('rate_429')
const latencyMe = new Trend('lat_me')
const latencyPersonas = new Trend('lat_personas')
const latencyChat = new Trend('lat_chat')

export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '5m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'lat_me': ['p(95)<500'],
    'lat_personas': ['p(95)<800'],
    'http_req_failed{check_type:non-throttle}': ['rate<0.01'],
    'rate_429': ['rate<0.05'],
  },
}

function authHeaders(vu) {
  const jwt = jwts[vu % jwts.length]
  return {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    tags: { check_type: 'non-throttle' },
  }
}

export default function () {
  const vu = __VU
  const h = authHeaders(vu)

  // 1. Hot-path read: /users/me — should be < 500ms p95 under load
  const rMe = http.get(`${BASE}/users/me`, h)
  latencyMe.add(rMe.timings.duration)
  check(rMe, { '/users/me 200': (r) => r.status === 200 })
  if (rMe.status === 429) rate429.add(1)
  else rate429.add(0)

  sleep(1)

  // 2. Medium read: /personas (list)
  const rP = http.get(`${BASE}/personas`, h)
  latencyPersonas.add(rP.timings.duration)
  check(rP, { '/personas 200': (r) => r.status === 200 })

  sleep(2)

  // 3. LLM POST: quick-chat — the quota-enforced path
  const rChat = http.post(
    `${BASE}/orchestration/quick-chat`,
    JSON.stringify({ message: 'Hello from k6 load test. Reply briefly.' }),
    h,
  )
  latencyChat.add(rChat.timings.duration)
  check(rChat, {
    'quick-chat 200 or 429': (r) => [200, 429].includes(r.status),
    'quick-chat not 5xx': (r) => r.status < 500,
  })
  if (rChat.status === 429) rate429.add(1)

  sleep(3)
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data),
    'tests/loadtest/summary.json': JSON.stringify(data, null, 2),
  }
}

function textSummary(data) {
  const m = data.metrics
  return `
=== 4Ever k6 load test summary ===
Total requests: ${m.http_reqs?.values?.count || 0}
Failed: ${(m.http_req_failed?.values?.rate * 100 || 0).toFixed(2)}%
429 rate: ${(m.rate_429?.values?.rate * 100 || 0).toFixed(2)}%
p95 /users/me: ${m.lat_me?.values?.['p(95)']?.toFixed(0) || 'n/a'}ms
p95 /personas: ${m.lat_personas?.values?.['p(95)']?.toFixed(0) || 'n/a'}ms
p95 quick-chat: ${m.lat_chat?.values?.['p(95)']?.toFixed(0) || 'n/a'}ms
`
}
