# Open items
Summary: things not finished or never verified, as of 2026-10-12. Re-check before relying on any of them.

- Accounts: need the Upstash Redis store connected on Vercel (Storage) and a redeploy; still unconfirmed on 2026-10-12 (the sandbox can't reach dop.vercel.app to check). Until then the Account page says accounts aren't on. Auto-sync uploads the whole snapshot each time; watch Upstash's free monthly limits if data grows large.
- DopNet student: disabled until `scripts/student/gate.ts` passes; check the `ai-training` release's arena results.
- AI chain starts only after an AI training run on current code finishes.
- Engine never measured on a real GPU, Windows or phone hardware; PC helper and home trainer untested on Windows/NVIDIA; the phone tunnel (cloudflared quick tunnel) was never tested end to end because the cloud sandbox can't reach trycloudflare.com.
- Forge: only 3 of 32 life problems are "kill"; framing could be tuned.
- Coach chat never tried against live Gemini.
- Closed idea: training a net from zero on XIAO's RTX 5070 (PR #6) was dropped as pointless.
- Kami (2026-10-15): b18 on WebGPU inside Kami never measured; the Kami Vercel project, real Gemini wording (Myoshu) and Kami Local (no model uploaded yet) never tried live; the home trainer never ran on the RTX 5070. Forge problems can probably rejoin the training tasks now that setup stones read correctly (see kami-factory.md).
- Stored analyses of games with setup stones (handicap) were wrong before 2026-10-15; with ANALYSIS_VERSION 4 they no longer count as current, so the analysis queue redoes them. A Doppelgänger copy built from handicap games may need a retrain (Copy page) once those analyses are redone.
