import { markdownLanguage } from '@codemirror/lang-markdown';
import { externalNoteReferences } from '../editor/externalNote.ts';
import { displayMathRanges, inlineMathRanges } from '../editor/markdownParser.ts';
import { resolveFileReference } from './paths.ts';

export interface AiImageCandidate { path: string; name: string }

/** Local image attachments only. Parsing excludes code, math, comments and remote URLs. */
export function aiImageCandidates(markdown: string, note: string, vault: string): AiImageCandidate[] {
	const unique = new Map<string, AiImageCandidate>();
	for (const reference of externalNoteReferences(markdown)) {
		const { path } = resolveFileReference(reference.href, note, vault);
		if (!/\.(png|jpe?g|webp)$/i.test(path)) continue;
		if (!unique.has(path)) unique.set(path, { path, name: path.replace(/\\/g, '/').split('/').at(-1) || path });
	}
	return [...unique.values()];
}

/** Protect complete image nodes and reference definitions, not a regex fragment of a URL. */
export function protectAiMedia(markdown: string, nonce = crypto.randomUUID().replace(/-/g, '')): { text: string; media: Map<string, string> } {
	const ranges: { from: number; to: number }[] = [];
	const math = [...displayMathRanges(markdown), ...inlineMathRanges(markdown)];
	const parser = (markdownLanguage.parser as unknown as { configure(spec: { remove: string[] }): typeof markdownLanguage.parser }).configure({ remove: ['IndentedCode'] });
	const tree = parser.parse(markdown);
	tree.iterate({ enter(node) {
		if (math.some(range => node.from >= range.from && node.from < range.to)) return false;
		if (node.name === 'Image' || node.name === 'LinkReference') {
			ranges.push({ from: node.from, to: node.to });
			return false;
		}
		if (node.name !== 'HTMLTag' && node.name !== 'HTMLBlock') return;
		const html = markdown.slice(node.from, node.to);
		const pattern = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|pre|code)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<div\b[^>]*class=["'][^"']*\bpdf-embed\b[^"']*["'][^>]*>[\s\S]*?<\/div>|<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
		for (const match of html.matchAll(pattern)) {
			if (match[0].startsWith('<!--') || match[1]) continue;
			ranges.push({ from: node.from + match.index!, to: node.from + match.index! + match[0].length });
		}
	} });
	ranges.sort((a, b) => a.from - b.from || b.to - a.to);
	const media = new Map<string, string>();
	let cursor = 0;
	let text = '';
	for (const range of ranges) {
		if (range.from < cursor) continue;
		const key = `__MEDIA_${nonce}_${media.size}__`;
		media.set(key, markdown.slice(range.from, range.to));
		text += markdown.slice(cursor, range.from) + key;
		cursor = range.to;
	}
	return { text: text + markdown.slice(cursor), media };
}

/** Refuse to apply a response which lost/duplicated media; never silently drop attachments. */
export function restoreAiMedia(result: string, media: ReadonlyMap<string, string>): string | null {
	for (const key of media.keys()) if (result.split(key).length !== 2) return null;
	for (const [key, original] of media) result = result.replace(key, () => original);
	return result;
}
