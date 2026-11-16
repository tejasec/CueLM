#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { ScopedVault } from './vault.mjs';
import { createServer } from './server.mjs';

const usage='Usage: node packages/mcp/src/cli.mjs --vault /absolute/path/to/initialized/vault';
try {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help')process.stdout.write(`${usage}\nRead-only local MCP server. No note writes, network listener or provider calls.\n`);
  else {
    if(args.length!==2||args[0]!=='--vault')throw Error(usage);
    const server=await createServer(await ScopedVault.open(args[1]));
    process.once('SIGINT',()=>{void server.close();});
    process.once('SIGTERM',()=>{void server.close();});
    await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:8*1024*1024}));
  }
} catch(error) {
  process.stderr.write(`HelixNotes MCP: ${error.code?`Could not open the selected vault (${error.code}).`:error.message}\n`);
  process.exitCode=1;
}
