/**
 * End-to-end smoke test: spawns the Looper MCP server over stdio with the
 * official SDK client and exercises tools/list + status + chat + missions.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/mcp/index.ts'],
});

const client = new Client({ name: 'mcp-smoke', version: '0.1.0' });

const textOf = (result: unknown): string => {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
};

await client.connect(transport);
console.log('connected\n');

const tools = await client.listTools();
console.log(`tools (${tools.tools.length}): ${tools.tools.map((t) => t.name).join(', ')}\n`);

console.log('-- looper_status --');
console.log(textOf(await client.callTool({ name: 'looper_status', arguments: {} })));

console.log('\n-- looper_profile (truncated) --');
console.log(textOf(await client.callTool({ name: 'looper_profile', arguments: {} })).slice(0, 600));

console.log('\n-- looper_chat --');
console.log(textOf(await client.callTool({ name: 'looper_chat', arguments: { message: 'one line: name your specialization' } })));

await client.close();
console.log('\nsmoke test complete');
