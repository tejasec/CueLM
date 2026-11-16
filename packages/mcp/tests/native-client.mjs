// Invoked only by the isolated Rust native-host test. No real vault or GUI profile is used.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [binary,connection,path]=process.argv.slice(2);
const transport=new StdioClientTransport({command:binary,args:['--mcp-stdio','--connection',connection],stderr:'pipe',env:{...process.env,HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9'}});
let stderr='';transport.stderr.on('data',chunk=>{stderr+=chunk;});
const client=new Client({name:'helixnotes-native-test',version:'1.0.0'});
try {
  await client.connect(transport);
  const tools=await client.listTools();assert.equal(tools.tools.length,6);assert.equal(tools.tools.find(tool=>tool.name==='edit_note').annotations.readOnlyHint,false);
  assert.equal((await client.listResources()).resources.length,9);
  const schema=await client.readResource({uri:'helixnotes://schema/frontmatter'});assert.equal(JSON.parse(schema.contents[0].text).additionalProperties,true);
  const first=await client.callTool({name:'read_note',arguments:{path}});assert.notEqual(first.isError,true);
  const before=first.structuredContent;assert.equal(before.frontmatter.canonical,true);assert.equal(before.frontmatter.fields.custom_owner,'Ada');assert.equal(before.frontmatter.known.created.length>0,true);
  const edit={path,expectedRevision:before.revision,find:'Original text',replace:'Updated through the packaged helper',tags:['mcp','work'],pinned:true};
  const result=await client.callTool({name:'edit_note',arguments:edit});assert.equal(result.structuredContent.applied,true);
  const reread=await client.callTool({name:'read_note',arguments:{path,expectedRevision:result.structuredContent.revision}});
  const after=reread.structuredContent;assert.equal(after.frontmatter.known.id,before.frontmatter.known.id);assert.equal(after.frontmatter.known.created,before.frontmatter.known.created);assert.equal(after.frontmatter.fields.custom_owner,'Ada');assert.ok(after.body.includes('Updated through the packaged helper'));assert.equal(after.frontmatter.known.pinned,true);
  assert.equal((await client.callTool({name:'edit_note',arguments:edit})).isError,true);
  assert.equal((await client.callTool({name:'read_note',arguments:{path:'../outside.md'}})).isError,true);
  assert.equal((await client.callTool({name:'read_note',arguments:{path:'.helixnotes/config.json'}})).isError,true);
  const guide=await client.callTool({name:'get_feature_guide',arguments:{topic:'editing'}});assert.equal(guide.structuredContent.writeToolsAvailable,true);assert.ok(guide.structuredContent.markdown.includes('unsaved'));
} finally {await client.close();await transport.close();}
assert.equal(stderr,'');
process.stdout.write('Packaged Rust helper ↔ official TypeScript MCP client: passed\n');
