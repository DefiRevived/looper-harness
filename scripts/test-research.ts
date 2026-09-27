/**
 * Research-layer smoke test: web search, page fetch, SSRF guard, contract
 * discovery (Blockscout) and the Blockscout ABI fallback.
 */
import { executeToolCall, type ToolContext } from '../src/core/tools.js';
import { webFetch, webSearch } from '../src/core/research.js';

const ctx: ToolContext = { sessionKey: 'web:999955', surface: 'web', tokenId: 452 };
let failures = 0;
const expect = (cond: boolean, label: string): void => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
};

const call = (name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

console.log('===== web_search: where do Loopers trade? =====');
const search = await call('web_search', { query: 'loopers nft base opensea collection' });
console.log(search.modelText.split('\n').slice(0, 10).join('\n'));
expect(search.modelText.includes('opensea.io'), 'search finds an OpenSea result');

console.log('\n===== web_fetch: plain page + JSON =====');
const ex = await call('web_fetch', { url: 'https://example.com' });
expect(ex.modelText.includes('Example Domain'), 'example.com fetch works');
const json = await call('web_fetch', { url: 'https://base.blockscout.com/api/v2/search?q=Loopers' });
expect(json.modelText.includes('0x1649CD37f4748807b4882FC48765bA0B2aFfa94a'), 'blockscout JSON fetch works (collection address present)');

console.log('\n===== SSRF guard =====');
const local = await call('web_fetch', { url: 'http://127.0.0.1:4520/api/vitals' });
console.log(local.modelText.slice(0, 130));
expect(local.modelText.includes('refusing') || local.modelText.includes('failed'), 'loopback refused');
const local2 = await call('web_fetch', { url: 'http://localhost:4520/' });
expect(local2.modelText.includes('refusing') || local2.modelText.includes('failed'), 'localhost refused');
const meta = await call('web_fetch', { url: 'http://169.254.169.254/latest/meta-data/' });
expect(meta.modelText.includes('refusing') || meta.modelText.includes('failed'), 'metadata IP refused');

console.log('\n===== lookup_contract =====');
const looper = await call('lookup_contract', { query: 'Loopers' });
console.log(looper.modelText.split('\n').slice(0, 8).join('\n'));
expect(looper.modelText.includes('0x1649CD37f4748807b4882FC48765bA0B2aFfa94a'), 'finds the Loopers collection');
const byAddr = await call('lookup_contract', { query: '0x0000000000000068F116a894984e2DB1123eB395' });
console.log(byAddr.modelText.split('\n').slice(0, 4).join('\n'));
expect(/0x0000000000000068f116a894984e2db1123eb395/i.test(byAddr.modelText), 'address search resolves (Seaport)');

console.log('\n===== ABI via lookup (Sourcify or Blockscout) =====');
const abi = await call('fetch_contract_abi', { chain: 'base', address: '0x0000000000000068F116a894984e2DB1123eB395' });
expect(/fulfill/i.test(abi.modelText), 'Seaport ABI resolved with fulfill functions');

console.log('\n===== direct module check (search engines reachable) =====');
const direct = await webSearch('loopers base');
expect(direct.results.length > 0, `webSearch returned ${direct.results.length} results via ${direct.engine}`);
const page = await webFetch('https://base.blockscout.com/api/v2/smart-contracts/0x1649CD37f4748807b4882FC48765bA0B2aFfa94a');
expect(page.text.includes('"abi"') || page.text.includes('0x'), 'blockscout contract JSON readable');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall research checks passed');
process.exit(failures ? 1 : 0);
