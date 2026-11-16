import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectMarkdown, FRONTMATTER_SCHEMA, MAX_FRONTMATTER_BYTES } from '../src/frontmatter.mjs';

const header='id: stable-legacy-id\ntitle: A title\ntags: [work, "2024", "a: b"]\npinned: false\ncreated: 2024-01-01\nmodified: 2024-01-02T10:30:00Z\n';
test('schema stays aligned with the native known frontmatter fields',async()=>{
  const source=await readFile(new URL('../../../src-tauri/src/vault/frontmatter.rs',import.meta.url),'utf8');
  const fields=[...source.match(/struct RawFrontmatter \{([\s\S]*?)\n\}/u)[1].matchAll(/^\s+(\w+):/gmu)].map(match=>match[1]);
  assert.deepEqual(Object.keys(FRONTMATTER_SCHEMA.properties),fields);
  assert.equal(FRONTMATTER_SCHEMA.additionalProperties,true);
});
test('canonical metadata and unknown keys are reported without changing the body or input',()=>{
  const raw=`---\n${header}custom:\n  owner: Ada\n---\n# A title\n\n- [ ] Ship !high due:2026-12-01  \n`;
  const result=inspectMarkdown(raw,'different-name.md');
  assert.equal(result.frontmatter.canonical,true);assert.equal(result.frontmatter.known.id,'stable-legacy-id');
  assert.deepEqual(result.frontmatter.unknownKeys,['custom']);assert.deepEqual(result.frontmatter.fields.custom,{owner:'Ada'});
  assert.equal(result.body,'# A title\n\n- [ ] Ship !high due:2026-12-01  \n');assert.ok(raw.includes('owner: Ada'));
});
test('legacy scalar forms retain large numeric identities exactly and do not fabricate dates',()=>{
  const result=inspectMarkdown('---\nid: 9876543210123456789\ntitle: 42\ntags: work, home\npinned: yes\n---\ntext','a-name.md');
  assert.equal(result.frontmatter.known.id,'9876543210123456789');assert.equal(result.frontmatter.known.title,'42');
  assert.deepEqual(result.frontmatter.known.tags,['work','home']);assert.equal(result.frontmatter.known.pinned,true);
  assert.equal(result.frontmatter.known.created,null);assert.equal(result.frontmatter.known.modified,null);
  assert.equal(result.frontmatter.canonical,false);
  assert.equal(inspectMarkdown('No header','my-note - subtitle.md').frontmatter.known.title,'my note - subtitle');
  assert.equal(inspectMarkdown('No header').frontmatter.known.id,'');
});
test('malformed, duplicate, non-mapping, custom-tag and alias YAML is rejected without dropping original YAML',()=>{
  for(const yaml of ['id: [bad','id: a\nid: b','[a, b]','value: !js/function bad','a: &a [1]\nb: *a','value: .inf']) {
    const result=inspectMarkdown(`---\n${yaml}\n---\nbody`);
    assert.equal(result.frontmatter.valid,false,yaml);assert.equal(result.frontmatter.yaml,`${yaml}\n`);assert.equal(result.body,'body');
  }
  assert.equal(inspectMarkdown('---\nno closing header').body,'---\nno closing header');
});
test('custom prototype-looking keys remain ordinary data',()=>{
  const result=inspectMarkdown(`---\n${header}__proto__:\n  polluted: yes\n---\nbody`);
  assert.equal(Object.prototype.polluted,undefined);
  assert.equal(result.frontmatter.known.id,'stable-legacy-id');
  assert.ok(result.frontmatter.unknownKeys.includes('__proto__'));
  assert.equal(Object.hasOwn(result.frontmatter.fields,'__proto__'),true);
});
test('bounds, invalid dates, BOM and CRLF headers are handled explicitly',()=>{
  for(const yaml of ['x: '+ 'a'.repeat(MAX_FRONTMATTER_BYTES),' '.repeat(201)+'x: 1','x: '+ '['.repeat(80)+'0'+']'.repeat(80)])assert.equal(inspectMarkdown(`---\n${yaml}\n---\nbody`).frontmatter.valid,false);
  const result=inspectMarkdown(`\uFEFF---\r\n${header.replaceAll('\n','\r\n')}---\r\nbody  \r\n`);
  assert.equal(result.frontmatter.canonical,true);assert.equal(result.body,'body  \r\n');
  const invalid=inspectMarkdown(`---\n${header.replace('2024-01-01','2024-02-30')}---\nbody`);
  assert.equal(invalid.frontmatter.known.created,null);assert.equal(invalid.frontmatter.canonical,false);
});
