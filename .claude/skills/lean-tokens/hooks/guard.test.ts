import { test, expect } from 'claude-code/testing'
import { bigReadReason, quietNpm, capGitLog, trimLines } from './guard'

test('blocks whole big reads, allows ranged and small ones', () => {
  expect(bigReadReason('/r/README.md', false)).toBeDefined()
  expect(bigReadReason('/r/package-lock.json', false)).toBeDefined()
  expect(bigReadReason('/r/public/models/x.bin.gz', false)).toBeDefined()
  expect(bigReadReason('/r/node_modules/a/b.js', false)).toBeDefined()
  expect(bigReadReason('/r/README.md', true)).toBeUndefined()
  expect(bigReadReason('/r/CLAUDE.md', false)).toBeUndefined()
  expect(bigReadReason('/r/docs/handoff/ux.md', false)).toBeUndefined()
  expect(bigReadReason('/r/src/App.tsx', false)).toBeUndefined()
})

test('quiets npm install and ci only', () => {
  expect(quietNpm('npm ci')).toBe('npm ci --no-audit --no-fund --loglevel=error')
  expect(quietNpm('npm test')).toBe('npm test')
  expect(quietNpm('npm ci --loglevel=warn')).toBe('npm ci --loglevel=warn')
})

test('caps unbounded git log, leaves bounded or piped ones', () => {
  expect(capGitLog('git log --oneline')).toBe('git log --oneline -n 30')
  expect(capGitLog('git log -5')).toBe('git log -5')
  expect(capGitLog('git log -n 10 --stat')).toBe('git log -n 10 --stat')
  expect(capGitLog('git log | head')).toBe('git log | head')
  expect(capGitLog('git status')).toBe('git status')
})

test('trims only long output and keeps head and tail', () => {
  const short = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n')
  expect(trimLines(short)).toBe(short)
  const long = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n')
  const out = trimLines(long)
  expect(out).toContain('l0')
  expect(out).toContain('l499')
  expect(out).toContain('trimmed 380 lines')
  expect(out.split('\n').length).toBe(121)
})
