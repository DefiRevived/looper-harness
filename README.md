# LOOPER AGENT HARNESS

A local agent runtime that turns a **Looper NFT (Base)** into a working agent. Point it at a token id and it
reads the token's on-chain record and Arweave personality codex, assembles the persona, and runs it as a
chat/agent with a tool-using brain — it can read the registry, research the web, read contracts, build web
apps and dapps in a real workspace, remember and lock its work, and package results for hosting.

One web console plus Telegram/Discord adapters and an MCP server, all sharing the same brain and memory.
The runtime holds no keys; everything is local-first with opt-in gates (see Security posture).

> Reference token: #452 (Mercenary / Fixer). The harness works for any of the 7,777 Loopers.

## Requirements

- **Node.js ≥ 20**
- Optional: a **DeepSeek API key** — empty runs a labeled mock brain so the whole pipeline stays testable offline
- Optional: Telegram / Discord bot tokens
- Optional: a local Edge/Chrome for `verify_render` (drives the installed browser; nothing is downloaded)

## Quickstart

```text
npm install
npm run libs        # fetch the vendored build libraries (three, gsap, ethers, d3, …)
cp .env.example .env        # Windows: Copy-Item .env.example .env
npm run dev         # → http://127.0.0.1:4520
```

`.env` essentials:

```text
LOOPER_TOKEN_ID=452             # REQUIRED — the token this runtime embodies (1–7777)
DEEPSEEK_API_KEY=               # empty → mock brain (the UI says so)
DEEPSEEK_MODEL=deepseek-flash   # valid names: deepseek-flash, deepseek-v4-pro
BASE_RPC_URL=https://mainnet.base.org
```

If `LOOPER_TOKEN_ID` is empty, the console asks for the token id on first boot — enter a Looper you own,
sign the gas-free ownership message, and the runtime loads its identity, codex and art on the spot.

`.env` is gitignored — keep keys there, never in code.

## What it does

- **Identity** — name / owner / `tokenURI` from Base, metadata + codex from Arweave (gateway rotation, disk
  cache, negative-caching of misses), then persona assembly from the codex; falls back to a synthesized
  persona when a token has no codex.
- **Tool-using brain** — DeepSeek with native function calling. Registry reads (`read_looper`), web research
  (`web_search` / `web_fetch` / `lookup_contract`), chain reads (`fetch_contract_abi` / `read_contract` /
  `simulate_call` / `tx_status`), markets (`market_price`), wallets (`read_wallet`), memory, tasks, locks,
  versions and builds.
- **Build workspace** — the agent builds real web projects under `data/artifacts/`: single pages, multi-file
  projects, or **real npm projects** (package.json + allowlisted deps + `npm install` + build script whose
  `dist/` is what gets previewed and hosted). Includes sandboxed preview, static self-containment check,
  headless render verification, version archive + revert, snippet locks, and per-build threads with their
  own memory.
- **Wallet bridge** — sandboxed build previews get a host-mediated EIP-1193 provider: reads pass through; a
  transaction is decoded, simulated, and shown in a host-rendered panel before the real wallet sees it.
  Blind-signing and raw-transaction methods are refused by policy.
- **Real Cred (display)** — reads the Helixa Cred trust assessment for the token's ERC-8004 agent when one is
  published and says "not published" otherwise. No invented scores.
- **Memory** — ReMEM-backed long-term memory, bounded per-thread history with a verbatim trim archive,
  nightly "dream" synthesis, tasks and locks.
- **Adapters** — Telegram/Discord bots sharing the brain (Telegram gets a small read-only tool lane) and an
  MCP server over stdio.

## Ownership verification

By default the harness verifies that the operator's wallet actually owns the token before activating it:
the console asks for one off-chain signature — the message carries your address, the token id and a nonce,
and states plainly that it is a check (no transaction, no gas). The server recovers the signer, compares it
with a fresh `ownerOf(tokenId)` read from Base, and issues a proof scoped to that token (valid 24 h).

- A valid signature from a wallet that does **not** own the token is refused, and the refusal names the
  actual owner.
- `LOOPER_REQUIRE_OWNERSHIP=false` disables the gate — useful for demos and for browsing a Looper you
  don't hold.
- Scope: the gate covers activation and the agent's main operations (identity, chat, vitals, dreams). It is
  not a full multi-tenant auth layer — per-visitor isolation for hosted use is on the roadmap.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Web console + API on `127.0.0.1:4520` (Express + Vite middleware) |
| `npm run bot` | Telegram/Discord adapters (needs tokens + `LOOPER_TOKEN_ID`) |
| `npm run mcp` | The agent as an MCP server over stdio |
| `npm run libs` | Fetch the vendored build libraries into `libs/` (regenerate anytime) |
| `npm run pack-build -- <build-id>` | Package one build as a static site folder under `deploy/` (resolves artwork, extracts images, strips the wallet shim) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` · `npm start` | Build the frontend to `dist/web` · serve it in production mode |

## MCP server

`npm run mcp` serves the configured token over stdio: `looper_status`, `looper_profile`, `looper_chat`,
`looper_reset`. VS Code is pre-wired via `.vscode/mcp.json`; for Claude Desktop / Cursor add a stdio server
with command `cmd`, args `["/c", "npm", "run", "mcp"]` in this folder.

The MCP server runs per client over stdio — no network port, so only the app that spawns it can reach it.

## Security posture

Local-first and keyless by default — the runtime never holds wallet keys and cannot move assets.

| Surface | Default | Turn on with |
| --- | --- | --- |
| Web console | bound to `127.0.0.1`, no auth | `LOOPER_API_TOKEN=…` (header `x-looper-token`, or bootstrap once with `?token=`) |
| Ownership gate | **on** — one gas-free signature per token, 24 h proof | `LOOPER_REQUIRE_OWNERSHIP=false` |
| Chat throttle | disabled | `CHAT_RATE_LIMIT_PER_MINUTE=20` |
| Telegram / Discord | open (startup warning) | `TELEGRAM_ALLOWED_CHAT_IDS` / `DISCORD_ALLOWED_USER_IDS` |
| MCP | stdio, process-scoped | — |

The wallet bridge refuses `eth_sign`, `personal_sign`, `eth_signTypedData*` and `eth_sendRawTransaction` by
policy, and every transaction goes through a host-rendered, simulated confirmation panel. (The console's own
ownership check signs a clearly-worded, inert message — bridge policy applies to dapp previews, not to this
explicit activation step.) The full doctrine lives in `docs/security-bible.md`. If you host this publicly,
mind LLM spend; the ownership gate protects activation, but full per-visitor isolation is still on the
roadmap.

## Real vs local

| Thing | Status |
| --- | --- |
| Persona / codex / art / owner / ERC-8004 agent + ERC-6551 account | **Real** — read from Base + Arweave |
| DeepSeek reasoning | **Real** — your key |
| Helixa Cred | **Real display** — the provider's published assessment, when it exists |
| Hosting / custom deployment | Whatever you wire up yourself (`pack-build` + any static host) |

## Layout

```text
src/core/    chain, arweave, codex, persona, brain, tools, memory, projects, research, web3, render, …
src/server/  express API (SSE chat) + vite middleware / static serving
src/web/     console UI (vanilla TS) + wallet shim + SIWA signer page
src/bot/     transport-agnostic commands + telegram/discord adapters
src/mcp/     MCP server over stdio
scripts/     libraries fetcher, build packager, smoke tests
data/        runtime state + caches (gitignored — safe to delete)
docs/        security doctrine
```

## Notes / gotchas

- **Public RPC limits:** `mainnet.base.org` returns `-32016` under load; the fallback transport rotates
  endpoints so reads keep working. Point `BASE_RPC_URL` at a paid endpoint for heavy use.
- **Arweave gateway drift:** an id can 404 on one gateway and resolve on another — that's why rotation is
  built in rather than trusting a single gateway.
- **Mode honesty:** mock and live replies are never mixed up in stored history; the mock disclosure lives in
  the UI badge / bot prefix, never inside message content that later feeds the model.
- **Port:** defaults to `4520` (`PORT` overrides). The console binds to `127.0.0.1` by default.

## License

MIT — see `LICENSE`. Built for the Loopers community; not affiliated with OpenSea or Helixa.
