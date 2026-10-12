import { test, expect } from 'claude-code/testing'
import { secretReason, bashReason, touchesEngine } from './guard'

test('flags keys and VITE_ secrets in source, not in docs', () => {
  expect(secretReason('src/a.ts', 'const k = import.meta.env.VITE_LLM_API_KEY')).toBeDefined()
  expect(secretReason('api/x.ts', 'const k = "AIzaSyA1234567890123456789012345678901"')).toBeDefined()
  expect(secretReason('api/x.ts', 'const k = process.env.LLM_API_KEY')).toBeUndefined()
  expect(secretReason('CLAUDE.md', 'never VITE_LLM_API_KEY')).toBeUndefined()
})

test('guards draft PRs, force-push to main, env files and stray weights', () => {
  expect(bashReason('gh pr create --draft --title x')).toBeDefined()
  expect(bashReason('gh api repos/o/r/pulls -F draft=true')).toBeDefined()
  expect(bashReason('gh api repos/o/r/pulls -f title=x -f head=b -f base=main')).toBeUndefined()
  expect(bashReason('git push --force origin main')).toBeDefined()
  expect(bashReason('git push -u origin claude/topic')).toBeUndefined()
  expect(bashReason('git add .env')).toBeDefined()
  expect(bashReason('git add .env.example')).toBeUndefined()
  expect(bashReason('git add public/models/other.bin.gz')).toBeDefined()
  expect(bashReason('git add public/models/g170e-b10c128-s1.bin.gz')).toBeUndefined()
  expect(bashReason('git add src/App.tsx')).toBeUndefined()
})

test('detects engine file edits', () => {
  expect(touchesEngine('/r/public/engine/katago.js')).toBe(true)
  expect(touchesEngine('/r/engine/build.sh')).toBe(false)
})
