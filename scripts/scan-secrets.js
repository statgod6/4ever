/**
 * Secret scanner for local pre-push checks and GitHub Actions.
 *
 * - Scans tracked and non-ignored untracked files.
 * - Pass --history to scan every reachable Git commit as well.
 * - Never prints matched credential material.
 */

const { createHash } = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')

const MAX_FILE_BYTES = 2 * 1024 * 1024
const SELF_PATH = 'scripts/scan-secrets.js'

const PATTERNS = [
  { name: 'OpenRouter key', rx: /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic key', rx: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'OpenAI key', rx: /\bsk-(?!or-v1-|ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Twilio SID', rx: /\bAC[0-9a-fA-F]{32}\b/g },
  {
    name: 'Twilio auth token',
    rx: /TWILIO[_A-Z]*TOKEN\s*[:=]\s*["']?[0-9a-fA-F]{32}\b/gi,
  },
  {
    name: 'AWS access key',
    rx: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
  },
  {
    name: 'AWS secret access key',
    rx: /AWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/gi,
  },
  { name: 'Google API key', rx: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    name: 'GitHub token',
    rx: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { name: 'GitLab token', rx: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'npm token', rx: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'Slack token', rx: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: 'Stripe live key', rx: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  {
    name: 'SendGrid key',
    rx: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: 'Private key block',
    rx: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    name: 'JWT bearer token',
    rx: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { name: 'E2B key', rx: /\be2b_[A-Za-z0-9_-]{24,}\b/g },
  { name: 'Tavily key', rx: /\btvly-[A-Za-z0-9_-]{20,}\b/g },
]

// The repository previously contained one expired development JWT. It is
// blocked if reintroduced into the current tree, but ignored at its historical
// location so full-history CI can establish a clean baseline without echoing it.
const HISTORY_ALLOWLIST = new Set([
  'mobile/src/store/authStore.ts:JWT bearer token:23dd1a56bf5ff37f81390d1fcaca3b85962cbf61642345825a41886eb34696a5',
])

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/')
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isKnownProviderExample(value) {
  return (
    value.includes('AKIAIOSFODNN7EXAMPLE') ||
    value.includes('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
  )
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, 8192)
  return sample.includes(0)
}

function lineNumber(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function scanText(text, context) {
  const findings = []

  for (const pattern of PATTERNS) {
    const rx = new RegExp(pattern.rx.source, pattern.rx.flags)
    for (const match of text.matchAll(rx)) {
      const value = match[0]
      if (isKnownProviderExample(value)) continue

      const hash = fingerprint(value)
      if (
        context.source === 'history' &&
        HISTORY_ALLOWLIST.has(`${context.file}:${pattern.name}:${hash}`)
      ) {
        continue
      }

      findings.push({
        ...context,
        pattern: pattern.name,
        line: context.source === 'worktree' ? lineNumber(text, match.index) : undefined,
      })
    }
  }

  return findings
}

function listWorktreeFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  )

  return [...new Set(output.split('\0').filter(Boolean).map(normalizePath))]
}

function scanWorktree() {
  const findings = []

  for (const file of listWorktreeFiles()) {
    if (file === SELF_PATH || !fs.existsSync(file)) continue

    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue

    const buffer = fs.readFileSync(file)
    if (isBinary(buffer)) continue

    findings.push(
      ...scanText(buffer.toString('utf8'), { source: 'worktree', file }),
    )
  }

  return findings
}

function scanHistory() {
  const findings = []
  const seen = new Set()
  const patch = execFileSync(
    'git',
    [
      'log',
      '--all',
      '--full-history',
      '-p',
      '--no-color',
      '--format=@@COMMIT %H',
      '--',
      '.',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  let commit = ''
  let file = ''

  for (const patchLine of patch.split(/\r?\n/)) {
    const commitMatch = patchLine.match(/^@@COMMIT ([0-9a-f]{40})$/)
    if (commitMatch) {
      commit = commitMatch[1]
      continue
    }

    const fileMatch = patchLine.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (fileMatch) {
      file = normalizePath(fileMatch[2])
      continue
    }

    if (
      !commit ||
      !file ||
      file === SELF_PATH ||
      !/^[+-][^+-]/.test(patchLine)
    ) {
      continue
    }

    const lineFindings = scanText(patchLine.slice(1), {
      source: 'history',
      file,
      commit,
    })

    for (const finding of lineFindings) {
      const key = `${finding.commit}:${finding.file}:${finding.pattern}`
      if (!seen.has(key)) {
        seen.add(key)
        findings.push(finding)
      }
    }
  }

  return findings
}

function report(findings) {
  if (findings.length === 0) {
    console.log('[ok] No high-confidence secrets found.')
    return
  }

  console.error(`[FAIL] ${findings.length} potential secret(s) found:`)
  for (const finding of findings) {
    const location =
      finding.source === 'history'
        ? `${finding.file} (commit ${finding.commit.slice(0, 8)})`
        : `${finding.file}:${finding.line}`
    console.error(`  ${location} [${finding.pattern}] VALUE_REDACTED`)
  }
  console.error('\nRotate confirmed credentials, remove them, and purge published history.')
  process.exitCode = 1
}

function main() {
  const includeHistory = process.argv.includes('--history')
  console.log(
    `Scanning non-ignored worktree files${includeHistory ? ' and reachable Git history' : ''}...`,
  )

  const findings = scanWorktree()
  if (includeHistory) findings.push(...scanHistory())
  report(findings)
}

main()
