# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository —
**Security** tab → **Report a vulnerability**. Do not open a public issue for
exploitable problems. You'll get an acknowledgement as fast as we reasonably
can, and updates through the fix.

## Posture — what this software does and doesn't do

- **Local-first by design.** The runtime binds `127.0.0.1` by default and keeps
  everything on your own machine: memory, sessions, transcripts, builds, and
  `looper.config.json` (including your DeepSeek key, written owner-only). The
  runtime itself holds no keys.
- **Outbound traffic** is limited to: the LLM API you configure (DeepSeek),
  Arweave gateways for Looper art/codex, and public Base RPC endpoints.
  No telemetry, no phone-home.
- **Ownership gate.** By default, activating a token requires a gas-free wallet
  signature that matches a fresh `ownerOf(tokenId)` read; agent routes are
  served only against that proof.
- **API surface.** The folder picker (`/api/fs/*`) and settings write through
  the same local process. If you ever bind beyond localhost, set
  `LOOPER_API_TOKEN` and treat the bind as trusted-network only — it is not a
  multi-tenant auth layer.
- **Untrusted inputs are handled as data.** Web research results are labeled
  untrusted; builds render in sandboxed iframes; wallet actions go through a
  host-rendered decode + simulation panel, and the agent never signs anything.
