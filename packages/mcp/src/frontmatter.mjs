import { parseDocument, isAlias, isMap, isSeq, isPair, isScalar } from 'yaml';

export const MAX_FRONTMATTER_BYTES = 64 * 1024;
export const FRONTMATTER_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Canonical HelixNotes note frontmatter', type: 'object', additionalProperties: true,
  properties: {
    id: { type: 'string', description: 'Stable note identity. New notes use UUIDs; preserve existing legacy IDs exactly. Never generate an ID on read.' },
    title: { type: 'string', description: 'Display title, independent of filename. Do not rename the file or stack extra H1 headings when changing it.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Literal tag names; quote numeric-, boolean- or colon-looking values in YAML.' },
    pinned: { type: 'boolean', description: 'Whether the note is pinned.' },
    created: { type: 'string', description: 'Creation timestamp. Preserve on edits. RFC 3339 recommended; legacy date-only and timezone-less dates are also read by the app.' },
    modified: { type: 'string', description: 'Modification timestamp. The native save path manages this on edits.' },
  },
};
const keys = Object.keys(FRONTMATTER_SCHEMA.properties);
const scalarText = value => ['string','number','boolean','bigint'].includes(typeof value) ? String(value) : null;
const jsonSafe = value => typeof value === 'bigint' ? String(value)
  : Array.isArray(value) ? value.map(jsonSafe)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,jsonSafe(item)])) : value;

export function splitFrontmatter(raw) {
  const source = raw.replace(/^\uFEFF/u, '');
  const start = /^---[ \t]*\r?\n/u.exec(source);
  if (!start) return { present: false, yaml: '', body: source };
  const rest = source.slice(start[0].length);
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/mu.exec(rest);
  if (!close) return { present: false, yaml: '', body: source, unclosed: true };
  return { present: true, yaml: rest.slice(0,close.index), body: rest.slice(close.index+close[0].length) };
}

function dateValid(value) {
  if (typeof value !== 'string') return false;
  const text=value.trim(), match=/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.exec(text);
  if (!match || Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`))) return false;
  if (new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0,10)!==match[1]) return false;
  if (match[2] && (+match[2]>23 || +match[3]>59 || +match[4]>59)) return false;
  if (/\.\d+/u.test(text) && !/(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) return false;
  return !Number.isNaN(Date.parse(match[2] ? text.replace(' ','T')+( /(?:Z|[+-]\d{2}:\d{2})$/u.test(text) ? '' : 'Z') : `${text}T00:00:00Z`));
}

/** Read-only inspection, not a replacement for the native merge/save implementation. */
export function inspectMarkdown(raw, filename = 'Untitled.md') {
  const split=splitFrontmatter(raw), diagnostics=[];
  const issue=(severity,message)=>diagnostics.push({severity,message});
  let fields=Object.create(null);
  if (split.unclosed) issue('warning','Unclosed opening --- is body text, not safe editable frontmatter.');
  if (split.present) {
    try {
      if (Buffer.byteLength(split.yaml,'utf8')>MAX_FRONTMATTER_BYTES) throw Error('Frontmatter exceeds 64 KiB.');
      for (const line of split.yaml.split('\n')) {
        if (/^ {201}/u.test(line)) throw Error('Frontmatter indentation exceeds the app’s safety limit.');
        if (/^(?:[ \t]*[-?:][ \t]+){33}/u.test(line)) throw Error('Too many nested YAML indicators.');
      }
      const doc=parseDocument(split.yaml,{intAsBigInt:true,uniqueKeys:true,version:'1.2'});
      if (doc.errors.length || doc.warnings.length) throw Error('Malformed, duplicate-key or unsupported-tag YAML.');
      if (doc.contents && !isMap(doc.contents)) throw Error('Note frontmatter must be a YAML mapping.');
      const stack=[[doc.contents,0]]; let nodes=0;
      while(stack.length) {
        const [node,depth]=stack.pop(); if(!node)continue;
        if(++nodes>10000 || depth>64)throw Error('Frontmatter is too deeply nested or complex.');
        // The app permits bounded aliases. MCP inspection is deliberately stricter:
        // JSON results cannot represent YAML alias cycles without losing information.
        if(isAlias(node))throw Error('YAML aliases are not supported by MCP inspection; preserve the original and use the app.');
        if(isScalar(node)&&typeof node.value==='number'&&!Number.isFinite(node.value))throw Error('Non-finite YAML numbers cannot be represented safely in MCP results.');
        if(isMap(node)||isSeq(node))for(const item of node.items)stack.push([item,depth+1]);
        if(isPair(node)) {
          if(!isScalar(node.key))throw Error('Complex YAML keys are not supported by MCP inspection.');
          stack.push([node.key,depth+1],[node.value,depth+1]);
        }
      }
      fields=doc.toJS({maxAliasCount:0})??Object.create(null);
    } catch(error) { issue('error',error.message); }
  }
  const text=key=>scalarText(fields[key]);
  const fallback=filename.replace(/(?:\.md)+$/u,'').replace(/(?<=[^ ])[-_](?=[^ ])/gu,' ');
  const rawTags=fields.tags;
  const tags=Array.isArray(rawTags) ? rawTags.map(scalarText).filter(value=>value!==null)
    : scalarText(rawTags)?.split(',').map(value=>value.trim()).filter(Boolean)??[];
  const pin=fields.pinned;
  const pinned=typeof pin==='boolean' ? pin : typeof pin==='bigint' ? pin!==0n
    : typeof pin==='number' ? pin!==0 : ['true','yes','on','1'].includes(String(pin).trim().toLowerCase());
  for(const key of keys) {
    if(!Object.hasOwn(fields,key)) { issue('warning',`Missing ${key}; do not invent it during a read. The app supplies defaults when needed.`); continue; }
    const value=fields[key];
    const valid=key==='tags' ? Array.isArray(value)&&value.every(item=>typeof item==='string')
      : key==='pinned' ? typeof value==='boolean' : typeof value==='string';
    if(!valid)issue('warning',`${key} uses a non-canonical type. The app tolerates common legacy forms; preserve the original YAML.`);
    if((key==='created'||key==='modified')&&!dateValid(value))issue('warning',`${key} is not a supported date. Do not replace it with a fabricated timestamp during a read.`);
  }
  return {
    body:split.body,
    frontmatter:{ present:split.present, yaml:split.yaml, fields:jsonSafe(fields), unknownKeys:Object.keys(fields).filter(key=>!keys.includes(key)),
      known:{id:text('id')??'',title:text('title')??fallback,tags,pinned,created:dateValid(fields.created)?fields.created:null,modified:dateValid(fields.modified)?fields.modified:null},
      valid:!diagnostics.some(item=>item.severity==='error'), canonical:split.present&&diagnostics.length===0, diagnostics },
  };
}
