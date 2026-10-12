# Open items
Summary: things not finished or never verified, as of 2026-10-12. Re-check before relying on any of them.

- Accounts: need the Upstash Redis store connected on Vercel (Storage) and a redeploy; unknown whether XIAO did it. Backup file export/import works without it.
- DopNet student: disabled until `scripts/student/gate.ts` passes; check the `ai-training` release's arena results.
- AI chain starts only after an AI training run on current code finishes.
- Engine never measured on a real GPU, Windows or phone hardware; PC helper and home trainer untested on Windows/NVIDIA; the phone tunnel (cloudflared quick tunnel) was never tested end to end because the cloud sandbox can't reach trycloudflare.com.
- Forge: only 3 of 32 life problems are "kill"; framing could be tuned.
- Coach chat never tried against live Gemini.
- Closed idea: training a net from zero on XIAO's RTX 5070 (PR #6) was dropped as pointless.
