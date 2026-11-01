import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';

export function endpoint(value) { const u = new URL(value); if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Use an HTTP(S) API base URL without embedded credentials.'); return u.href.replace(/\/$/,'').replace(/\/v1$/,'') + '/v1'; }
export async function remoteModels(connection) {
  const response = await fetch(`${connection.base}/models`,{ headers:{ Authorization:`Bearer ${connection.key || ''}` },signal:AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Device returned ${response.status}. Check the API URL and key.`);
  const result = await response.json(); if (!Array.isArray(result.data)) throw new Error('This device did not return an OpenAI-compatible model list.');
  return result.data.map(m => ({ id:m.id })).filter(m => typeof m.id === 'string');
}
export class McpManager {
  constructor() { this.clients = new Map(); }
  snapshot(configs) { return configs.map(c => ({ id:c.id,name:c.name,transport:c.transport,command:c.command,args:c.args,url:c.url,connected:this.clients.has(c.id),tools:this.clients.get(c.id)?.tools.map(t => ({ name:t.name,description:t.description })) || [] })); }
  async connect(config) {
    await this.disconnect(config.id);
    const client = new Client({ name:'forge',version:'0.2.0' },{ capabilities:{} });
    const transport = config.transport === 'stdio' ? new StdioClientTransport({ command:config.command,args:config.args || [],env:{ ...process.env,...config.env },stderr:'pipe' }) : new StreamableHTTPClientTransport(new URL(config.url),{ requestInit:config.key ? { headers:{ Authorization:`Bearer ${config.key}` } } : {} });
    try { await client.connect(transport,{ timeout:15000 }); const { tools } = await client.listTools({}, { timeout:15000 }); this.clients.set(config.id,{ client,transport,tools }); client.onclose = () => this.clients.delete(config.id); return tools; }
    catch (error) { await client.close().catch(() => {}); throw error; }
  }
  async disconnect(id) { const active = this.clients.get(id); this.clients.delete(id); if (active) await active.client.close(); }
  definitions() {
    const out = [];
    for (const [serverId, active] of this.clients) for (const tool of active.tools) {
      const name = `mcp_${createHash('sha256').update(serverId + ':' + tool.name).digest('hex').slice(0,16)}`;
      out.push({ type:'function',function:{ name,description:`MCP ${tool.name}: ${tool.description || ''} (requires approval)`.slice(0,2000),parameters:tool.inputSchema || { type:'object',properties:{} } },serverId,original:tool.name });
    }
    return out;
  }
  async call(name,args,signal) { const tool = this.definitions().find(t => t.function.name === name); if (!tool) throw new Error('MCP tool is disconnected or unavailable.'); return this.clients.get(tool.serverId).client.callTool({ name:tool.original,arguments:args },undefined,{ signal,timeout:60000 }); }
  async close() { await Promise.allSettled([...this.clients.keys()].map(id => this.disconnect(id))); }
}
