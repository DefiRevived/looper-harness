# Contributing

Small, honest patches are welcome.

## Dev setup

Node ≥ 20 (22 recommended).

```text
npm install
npm run libs        # vendor the build libraries (three, gsap, ethers, d3, …)
npm run dev         # console on http://127.0.0.1:4520
```

No `.env` is required: without `LOOPER_TOKEN_ID` the console asks for a token id
on first boot, and without a DeepSeek key the brain runs in labeled mock mode —
the full pipeline stays testable offline.

## Checks

- `npm run typecheck` — must pass (CI enforces it).
- `npm run build` — frontend compile check.
- `scripts/test-*.ts` — run with `npx tsx scripts/<name>.ts`. Live checks
  (chain / Arweave / LLM) skip themselves when their prerequisites are absent;
  several suites expect the dev server on `127.0.0.1:4520`.

## Ground rules

- Keep the local-first posture: no telemetry, no phone-home, no hidden network
  calls; user data stays in the directories the user chose.
- Receipts over claims: run the thing, quote what it actually reported, never
  invent verdicts (this is also the house style the agent itself is held to).
- One focused change per commit; explain *why* in the message.
