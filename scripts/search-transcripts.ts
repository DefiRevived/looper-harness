/**
 * Search the verbatim transcript archive (data/transcripts/*.jsonl).
 * Usage:
 *   node_modules\.bin\tsx.cmd scripts\search-transcripts.ts <term> [--limit N] [--session KEY]
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/core/config.js';

const args = process.argv.slice(2);
const term = args.find((a) => !a.startsWith('--'));
if (!term) {
  console.log('usage: search-transcripts.ts <term> [--limit N] [--session web:<tokenId>]');
  process.exitCode = 1;
} else {
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 20 : 20;
  const sessIdx = args.indexOf('--session');
  const sessionFilter = sessIdx >= 0 ? args[sessIdx + 1] : undefined;

  const root = path.join(config.dataDir, 'transcripts');
  if (!fs.existsSync(root)) {
    console.log('no transcripts archived yet');
  } else {
    let shown = 0;
    for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.jsonl'))) {
      const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        if (shown >= limit) break;
        let rec: { marker?: string; sessionKey?: string; role?: string; at?: string; content?: string; reason?: string };
        try {
          rec = JSON.parse(line) as typeof rec;
        } catch {
          continue;
        }
        if (rec.marker || !rec.content) continue;
        if (sessionFilter && rec.sessionKey !== sessionFilter) continue;
        if (!rec.content.toLowerCase().includes(term.toLowerCase())) continue;
        shown++;
        const hit = rec.content.replace(/\s+/g, ' ');
        console.log(`[${rec.sessionKey}] ${rec.at} (${rec.role}, archived via ${rec.reason}):`);
        console.log(`  ${hit.slice(0, 220)}${hit.length > 220 ? '…' : ''}`);
      }
    }
    console.log(shown ? `\n${shown} match${shown === 1 ? '' : 'es'}` : 'no matches');
  }
}
