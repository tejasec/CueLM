import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
async function connect(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'helix-mcp-protocol-'));
  await fs.mkdir(path.join(root,'.helixnotes'));await fs.writeFile(path.join(root,'.helixnotes/config.json'),'{}');
  const raw='---\nid: stable-id\ntitle: Work\ncustom: preserve\n---\n# Work\n\nOriginal body 😀\n';await fs.writeFile(path.join(root,'work.md'),raw);
  const transport=new StdioClientTransport({command:process.execPath,args:[cli,'--vault',root],stderr:'pipe'});let stderr='';transport.stderr.on('data',chunk=>{stderr+=chunk;});
  const client=new Client({name:'helixnotes-mcp-test',version:'1.0.0'});
  t.after(async()=>{await client.close();await transport.close();await fs.rm(root,{recursive:true,force:true});assert.equal(stderr,'');});
  await client.connect(transport);return {client,root,raw};
}

test('real stdio initialization discovers tools/resources and inspects, validates and searches without writing', {timeout:20000},async t=>{
  const {client,root,raw}=await connect(t);
  const tools=await client.listTools();assert.deepEqual(tools.tools.map(tool=>tool.name).sort(),['get_feature_guide','list_notes','read_note','search_notes','validate_note']);
  assert.ok(tools.tools.every(tool=>tool.annotations.readOnlyHint&&tool.annotations.openWorldHint===false));
  const resources=await client.listResources();assert.equal(resources.resources.length,9);
  const schema=await client.readResource({uri:'helixnotes://schema/frontmatter'});assert.equal(JSON.parse(schema.contents[0].text).properties.id.type,'string');
  const listing=await client.callTool({name:'list_notes',arguments:{}});assert.deepEqual(listing.structuredContent.notes,['work.md']);
  const read=await client.callTool({name:'read_note',arguments:{path:'work.md',maxChars:4}});const note=read.structuredContent;
  assert.equal(note.frontmatter.known.id,'stable-id');assert.deepEqual(note.frontmatter.unknownKeys,['custom']);assert.equal(note.body,'# Wo');assert.equal(note.nextBodyOffset,4);assert.equal(note.raw,undefined);
  const next=await client.callTool({name:'read_note',arguments:{path:'work.md',bodyOffset:4,expectedRevision:note.revision}});assert.equal(note.body+next.structuredContent.body,'# Work\n\nOriginal body 😀\n');
  const found=await client.callTool({name:'search_notes',arguments:{query:'Original'}});assert.equal(found.structuredContent.results[0].path,'work.md');
  const validation=await client.callTool({name:'validate_note',arguments:{markdown:'---\na: &a [1]\nb: *a\n---\nbody'}});assert.equal(validation.structuredContent.applied,false);assert.equal(validation.structuredContent.frontmatter.valid,false);
  const guide=await client.callTool({name:'get_feature_guide',arguments:{topic:'features'}});assert.ok(guide.structuredContent.markdown.includes('Encrypted secret blocks'));assert.equal(guide.structuredContent.writeToolsAvailable,false);
  assert.equal(await fs.readFile(path.join(root,'work.md'),'utf8'),raw);
  await fs.writeFile(path.join(root,'work.md'),raw+'External edit');
  const stale=await client.callTool({name:'read_note',arguments:{path:'work.md',expectedRevision:note.revision}});assert.equal(stale.isError,true);assert.match(stale.content[0].text,/note changed/u);
});

test('stdio tools refuse traversal, private metadata and unregistered write operations', {timeout:20000},async t=>{
  const {client}=await connect(t);
  for(const bad of ['../outside.md','.helixnotes/config.json','/etc/passwd']) {
    const result=await client.callTool({name:'read_note',arguments:{path:bad}});assert.equal(result.isError,true,bad);
  }
  let refused=false;
  try {const result=await client.callTool({name:'write_note',arguments:{path:'work.md',body:'overwrite'}});refused=!!result.isError;}catch {refused=true;}
  assert.equal(refused,true);assert.equal((await client.listTools()).tools.length,5);
});

test('CLI requires explicit scope and keeps startup errors off protocol stdout',()=>{
  for(const args of [[],['--vault','relative'],['--vault','/missing-helix-mcp-test-directory']]) {
    const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/HelixNotes MCP:/u);
  }
});
