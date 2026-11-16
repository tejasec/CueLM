import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ScopedVault, MAX_NOTE_BYTES } from '../src/vault.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'helix-mcp-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'.helixnotes'));await fs.writeFile(path.join(root,'.helixnotes/config.json'),'{}');return {root,vault:await ScopedVault.open(root)};}

test('opening requires an explicit absolute initialized vault and creates nothing',async t=>{
  await assert.rejects(ScopedVault.open('relative'),/absolute/u);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'helix-mcp-empty-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await assert.rejects(ScopedVault.open(root));assert.deepEqual(await fs.readdir(root),[]);
});
test('hidden, traversal, absolute, resource and non-note paths are blocked',async t=>{
  const {root,vault}=await fixture(t);await fs.writeFile(path.join(root,'a.md'),'a');
  for(const relative of ['../a.md','/a.md','a\\b.md','C:note.md','.helixnotes/config.json','assets/a.md','x/../a.md','x//a.md','.secret.md','file.txt','x\0.md'])await assert.rejects(vault.read(relative));
});
test('listing excludes hidden/resource trees and links, and pagination detects changed listings',async t=>{
  const {root,vault}=await fixture(t);
  for(const dir of ['Book','assets','.hidden']){await fs.mkdir(path.join(root,dir));await fs.writeFile(path.join(root,dir,'note.md'),dir);}
  await fs.writeFile(path.join(root,'a.md'),'a');await fs.writeFile(path.join(root,'z.md'),'z');
  const first=await vault.list({limit:1});assert.deepEqual(first.notes,['Book/note.md']);assert.equal(first.nextCursor,1);
  assert.deepEqual((await vault.list({cursor:1,limit:1,snapshot:first.snapshot})).notes,['a.md']);
  assert.deepEqual((await vault.list({folder:'Book'})).notes,['Book/note.md']);
  await fs.writeFile(path.join(root,'new.md'),'new');await assert.rejects(vault.list({snapshot:first.snapshot}),/listing changed/u);
});
test('symlink notes and descendant directory links cannot expose outside files',async t=>{
  const {root,vault}=await fixture(t);const outside=await fs.mkdtemp(path.join(os.tmpdir(),'helix-mcp-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'private.md'),'not authorized');
  try {await fs.symlink(path.join(outside,'private.md'),path.join(root,'link.md'));await fs.symlink(outside,path.join(root,'Book'),process.platform==='win32'?'junction':'dir');}
  catch(error){if(error.code==='EPERM'){t.skip('Symlink permission unavailable');return;}throw error;}
  await assert.rejects(vault.read('link.md'),/links/u);await assert.rejects(vault.read('Book/private.md'),/links/u);
  assert.deepEqual((await vault.list()).notes,[]);
});
test('reads preserve UTF-8 bytes, BOM, metadata and raw body, without assigning IDs or timestamps',async t=>{
  const {root,vault}=await fixture(t);const raw='\uFEFF---\r\ntitle: 日本語 😀\r\ncustom: keep\r\n---\r\ntext  \r\n';await fs.writeFile(path.join(root,'a.md'),raw);
  const first=await vault.read('a.md');assert.equal(first.raw,raw);assert.equal(first.body,'text  \r\n');assert.equal(first.frontmatter.known.id,'');assert.equal(first.frontmatter.known.created,null);
  assert.equal(first.revision,(await vault.read('a.md')).revision);assert.equal(await fs.readFile(path.join(root,'a.md'),'utf8'),raw);
  assert.deepEqual((await fs.readdir(path.join(root,'.helixnotes'))).sort(),['config.json']);
});
test('search is a bounded literal query, does not interpret regex, and reports unreadable files',async t=>{
  const {root,vault}=await fixture(t);await fs.writeFile(path.join(root,'a.md'),'literal [x] 日本語');await fs.writeFile(path.join(root,'b.md'),'no match');await fs.writeFile(path.join(root,'bad.md'),Buffer.from([255]));
  const found=await vault.search({query:'[x]'});assert.equal(found.results.length,1);assert.equal(found.results[0].path,'a.md');assert.equal(found.skipped,1);
  assert.equal((await vault.search({query:'.*'})).results.length,0);
});
test('oversized and invalid UTF-8 files are refused',async t=>{
  const {root,vault}=await fixture(t);await fs.writeFile(path.join(root,'large.md'),'a'.repeat(MAX_NOTE_BYTES+1));await fs.writeFile(path.join(root,'invalid.md'),Buffer.from([255]));
  await assert.rejects(vault.read('large.md'),/2 MiB/u);await assert.rejects(vault.read('invalid.md'),/UTF-8/u);
});
test('atomic replacement during a read is detected instead of returning mixed/stale content',async t=>{
  const {root,vault}=await fixture(t);await fs.writeFile(path.join(root,'a.md'),'original');const resolve=vault.resolve.bind(vault);let calls=0;
  vault.resolve=async(...args)=>{if(++calls===2){await fs.writeFile(path.join(root,'next.md'),'replacement');await fs.rename(path.join(root,'next.md'),path.join(root,'a.md'));}return resolve(...args);};
  await assert.rejects(vault.read('a.md'),/changed while reading/u);
});
test('a replaced root directory revokes the original scope',async t=>{
  const {root,vault}=await fixture(t);const retired=`${root}-retired`;t.after(()=>fs.rm(retired,{recursive:true,force:true}));await fs.rename(root,retired);await fs.mkdir(root);await fs.writeFile(path.join(root,'a.md'),'different vault');
  await assert.rejects(vault.read('a.md'),/vault directory changed/u);
});
