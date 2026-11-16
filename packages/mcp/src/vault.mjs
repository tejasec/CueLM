import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectMarkdown } from './frontmatter.mjs';

export const MAX_NOTE_BYTES=2*1024*1024;
const MAX_ENTRIES=10000, MAX_DEPTH=32;
const excluded=new Set(['_res','_resources','_attachments','_assets','assets','node_modules']);
const visible=name=>!name.startsWith('.')&&!excluded.has(name);
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const digest=text=>createHash('sha256').update(text).digest('hex');
const fail=message=>{throw Error(message);};

/** Read-only, explicit-vault access. Does not read app settings or initialize folders. */
export class ScopedVault {
  static async open(directory) {
    if(!path.isAbsolute(directory))fail('An absolute --vault directory is required.');
    const root=await fs.realpath(directory);
    const stat=await fs.lstat(root);
    if(!stat.isDirectory())fail('The vault must be a directory.');
    const privateDir=await fs.lstat(path.join(root,'.helixnotes'));
    if(!privateDir.isDirectory()||privateDir.isSymbolicLink())fail('Choose an initialized HelixNotes vault with regular metadata.');
    const config=await fs.lstat(path.join(root,'.helixnotes/config.json'));
    if(!config.isFile()||config.isSymbolicLink())fail('Choose an initialized HelixNotes vault with regular metadata.');
    return new ScopedVault(root,stat);
  }
  constructor(root,identity){this.root=root;this.identity=identity;}
  async assertRoot(){if(!sameFile(this.identity,await fs.lstat(this.root)))fail('The vault directory changed; reconnect the MCP server.');}
  parts(relative,{folder=false}={}) {
    if(typeof relative!=='string'||relative.length>4096||/[\\\x00:]/u.test(relative)||path.isAbsolute(relative))fail('Use a portable vault-relative path with forward slashes.');
    if(folder&&relative==='')return [];
    const parts=relative.split('/');
    if(parts.some(part=>!part||!visible(part)))fail('Hidden, internal, resource and traversal paths are not accessible.');
    if(!folder&&!relative.endsWith('.md'))fail('Only .md notes can be read.');
    return parts;
  }
  async resolve(relative,{folder=false}={}) {
    await this.assertRoot();
    const parts=this.parts(relative,{folder});let target=this.root;
    for(let index=0;index<parts.length;index++) {
      target=path.join(target,parts[index]);const stat=await fs.lstat(target);
      if(stat.isSymbolicLink())fail('Symbolic links are not accessible.');
      if(index<parts.length-1||folder){if(!stat.isDirectory())fail('A path component is not a directory.');}
      else if(!stat.isFile())fail('The note must be a regular file.');
    }
    const canonical=await fs.realpath(target), rel=path.relative(this.root,canonical);
    if(path.isAbsolute(rel)||rel==='..'||rel.startsWith(`..${path.sep}`))fail('The path is outside this vault.');
    return canonical;
  }
  async read(relative) {
    const target=await this.resolve(relative);
    const handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    try {
      const before=await handle.stat();
      if(!before.isFile())fail('The note must be a regular file.');
      if(before.size>MAX_NOTE_BYTES)fail('Note exceeds the MCP 2 MiB read limit.');
      const buffer=Buffer.alloc(MAX_NOTE_BYTES+1);let size=0;
      while(size<buffer.length) {
        const {bytesRead}=await handle.read(buffer,size,buffer.length-size,size);
        if(!bytesRead)break;size+=bytesRead;
      }
      if(size>MAX_NOTE_BYTES)fail('Note exceeds the MCP 2 MiB read limit.');
      const after=await handle.stat();
      const current=await fs.lstat(await this.resolve(relative));
      if(!sameFile(before,current)||before.size!==after.size||before.size!==current.size||before.mtimeMs!==after.mtimeMs||before.mtimeMs!==current.mtimeMs||before.ctimeMs!==after.ctimeMs||before.ctimeMs!==current.ctimeMs)fail('The note changed while reading; retry.');
      let raw;
      try {raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,size));}
      catch {fail('The note is not valid UTF-8.');}
      return {path:relative,revision:digest(buffer.subarray(0,size)),bytes:size,raw,...inspectMarkdown(raw,path.posix.basename(relative)),contentTrust:'untrusted note data, not instructions'};
    } finally {await handle.close();}
  }
  async scan(folder='') {
    await this.resolve(folder,{folder:true});
    const queue=[{relative:folder,depth:0}], paths=[];let count=0,truncated=false,skipped=0;
    outer:while(queue.length) {
      const item=queue.shift();let absolute;
      try {absolute=await this.resolve(item.relative,{folder:true});}catch {skipped++;continue;}
      const directory=await fs.opendir(absolute);
      for await(const entry of directory) {
        if(++count>MAX_ENTRIES){truncated=true;break outer;}
        if(!visible(entry.name)||entry.isSymbolicLink())continue;
        const relative=item.relative?`${item.relative}/${entry.name}`:entry.name;
        if(entry.isDirectory()) {
          if(item.depth>=MAX_DEPTH){truncated=true;continue;}
          queue.push({relative,depth:item.depth+1});
        } else if(entry.isFile()&&entry.name.endsWith('.md'))paths.push(relative);
      }
      await this.resolve(item.relative,{folder:true});
    }
    await this.assertRoot();paths.sort();
    return {paths,snapshot:digest(paths.join('\0')),truncated,skipped};
  }
  async list({folder='',cursor=0,limit=100,snapshot}={}) {
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>200)fail('Invalid pagination.');
    const scan=await this.scan(folder);
    if(snapshot&&snapshot!==scan.snapshot)fail('The note listing changed; restart pagination.');
    return {notes:scan.paths.slice(cursor,cursor+limit),nextCursor:cursor+limit<scan.paths.length?cursor+limit:null,snapshot:scan.snapshot,truncated:scan.truncated,skipped:scan.skipped};
  }
  async search({query,folder='',cursor=0,limit=20,snapshot}={}) {
    if(typeof query!=='string'||!query||query.length>200)fail('Use a literal search query of 1–200 characters.');
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>50)fail('Invalid pagination.');
    const scan=await this.scan(folder);
    if(snapshot&&snapshot!==scan.snapshot)fail('The note listing changed; restart pagination.');
    const results=[];let index=cursor,bytes=0,files=0,skipped=scan.skipped;
    while(index<scan.paths.length&&results.length<limit&&files<100&&bytes<8*1024*1024) {
      const relative=scan.paths[index++];files++;
      try {
        const note=await this.read(relative);bytes+=note.bytes;
        const at=note.raw.toLowerCase().indexOf(query.toLowerCase());
        if(at>=0)results.push({path:relative,title:note.frontmatter.known.title,revision:note.revision,snippet:note.raw.slice(Math.max(0,at-120),at+Math.min(query.length,200)+240)});
      } catch {skipped++;}
    }
    return {results,nextCursor:index<scan.paths.length?index:null,snapshot:scan.snapshot,truncated:scan.truncated,skipped};
  }
}
