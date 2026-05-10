/**
 * scan-secrets.js — pre-push secret scanner
 *
 * Belt-and-braces check before `git push`. Greps the tracked tree (and staged
 * diff) for patterns that look like real credentials. Exits non-zero if any
 * high-confidence match is found.
 *
 * Run from the repo root:
 *   node scripts/scan-secrets.js
 *
 * To wire as a pre-push hook:
 *   create .git/hooks/pre-push with:
 *       #!/bin/sh
 *       node scripts/scan-secrets.js || exit 1
 *   then chmod +x .git/hooks/pre-push
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// High-confidence patterns — format-unique prefixes that would rarely appear
// in docs or placeholder text.
const PATTERNS = [
  { name: 'OpenAI key', rx: /sk-[a-zA-Z0-9]{20,}/g },
  { name: 'OpenRouter key', rx: /sk-or-v1-[a-zA-Z0-9]{32,}/g },
  { name: 'Anthropic key', rx: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { name: 'Twilio SID', rx: /\bAC[0-9a-fA-F]{32}\b/g },
  { name: 'Twilio auth token (32-char hex adjacent to TWILIO)', rx: /TWILIO[_A-Z]*TOKEN\s*=\s*["']?[0-9a-fA-F]{32}\b/g },
  { name: 'AWS access key', rx: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'AWS secret key pattern', rx: /aws_secret[^=\n]*=\s*["']?[A-Za-z0-9/+=]{40}["']?/gi },
  { name: 'Google API key', rx: /AIza[0-9A-Za-z_\-]{35}/g },
  { name: 'GitHub personal token', rx: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: 'Slack token', rx: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: 'Private key block', rx: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'JWT with real payload', rx: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\b/g },
  { name: 'E2B key', rx: /\be2b_[a-f0-9]{32,}\b/g },
  { name: 'Tavily key', rx: /\btvly-[A-Za-z0-9]{20,}\b/g },
]

// Files that may legitimately contain samples — we downgrade findings here
// to warnings (still reported, but don't fail the run).
const ALLOWLIST_PATHS = [
  /^docs\//,
  /^\.env\.example$/,
  /^scripts\/scan-secrets\.js$/,
  /^README\.md$/,
]

function listTrackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && fs.existsSync(f) && fs.statSync(f).isFile())
}

function isBinary(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    // crude binary test — any NUL byte in the first 8KB
    const sample = buf.subarray(0, 8192)
    for (const b of sample) if (b === 0) return true
    return false
  } catch {
    return true
  }
}

function scan() {
  const files = listTrackedFiles()
  const findings = []

  for (const f of files) {
    if (isBinary(f)) continue
    // Only scan reasonably small files — configs, source
    const stat = fs.statSync(f)
    if (stat.size > 2 * 1024 * 1024) continue

    const content = fs.readFileSync(f, 'utf8')
    for (const { name, rx } of PATTERNS) {
      const matches = content.match(rx)
      if (!matches) continue
      const allowlisted = ALLOWLIST_PATHS.some((r) => r.test(f))
      for (const m of matches) {
        findings.push({
          file: f,
          pattern: name,
          match: m.length > 60 ? m.slice(0, 40) + '...' : m,
          allowlisted,
        })
      }
    }
  }

  return findings
}

function main() {
  console.log('Scanning tracked files for high-confidence secret patterns...')
  const findings = scan()

  const real = findings.filter((f) => !f.allowlisted)
  const warnings = findings.filter((f) => f.allowlisted)

  if (warnings.length) {
    console.log(`\n[warn] ${warnings.length} allowlisted finding(s) (not blocking):`)
    for (const w of warnings) {
      console.log(`  ${w.file}  [${w.pattern}]  ${w.match}`)
    }
  }

  if (real.length === 0) {
    console.log('\n[ok] No high-confidence secrets found in tracked files.')
    process.exit(0)
  }

  console.error(`\n[FAIL] ${real.length} potential secret(s) found in tracked files:`)
  for (const r of real) {
    console.error(`  ${r.file}  [${r.pattern}]  ${r.match}`)
  }
  console.error(`
Action required:
  1. Rotate the leaked credential in the provider dashboard immediately.
  2. Remove the value from the file (move to env var).
  3. If the commit has already been pushed, also purge history:
       git filter-repo --path <file> --invert-paths
     then rotate again (assume history copies are out there).
`)
  process.exit(1)
}

main()
