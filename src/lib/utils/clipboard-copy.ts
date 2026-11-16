/**
 * HTML copies are styled for the receiving document. Word, LibreOffice and many email
 * editors apply their own Normal paragraph style (typically 1.08 line spacing plus space
 * after) to bare `<p>` tags, so a copied note arrives with more vertical space than it has
 * in HelixNotes. Inline single spacing keeps the note's own blank lines as the only
 * paragraph spacing; the generated HTML stays semantic (p, h1, li, ...).
 */

import { DOMSerializer, type Schema } from '@tiptap/pm/model';

const COPY_BLOCK_TAGS = 'p|h[1-6]|li|blockquote';
const COPY_BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote';
const COPY_BLOCK_STYLE = 'line-height:100%';
const COPY_PARAGRAPH_STYLE = 'line-height:100%;margin:0';

/** Keep clipboard styling out of the schema's cached serializer used to save HTML blocks. */
export function createSingleLineClipboardSerializer(schema: Schema): DOMSerializer {
	const serializer = DOMSerializer.fromSchema(schema);
	const clipboardSerializer = new DOMSerializer(serializer.nodes, serializer.marks);
	clipboardSerializer.serializeFragment = (fragment, options, target) => {
		// Delegate to the unmodified serializer so recursive content holes keep their DOM parents.
		const dom = serializer.serializeFragment(fragment, options, target);
		const blocks = Array.from(dom.querySelectorAll<HTMLElement>(COPY_BLOCK_SELECTOR));
		if (dom.nodeType === 1 && (dom as HTMLElement).matches(COPY_BLOCK_SELECTOR)) {
			blocks.unshift(dom as HTMLElement);
		}
		for (const block of blocks) {
			block.style.lineHeight = '100%';
			if (block.tagName.toLowerCase() !== 'blockquote') block.style.margin = '0';
		}
		// Never move or reparse the result: <tbody>, <tr> and <td> need their table context.
		return dom;
	};
	return clipboardSerializer;
}

/**
 * Add single-line spacing to the block elements of a copied HTML fragment. Appending the
 * declarations lets them win over any inline line-height or margin already on the element.
 */
export function applySingleLineSpacing(html: string): string {
	return html.replace(
		new RegExp(`<(${COPY_BLOCK_TAGS})\\b([^>]*)>`, 'gi'),
		(_match, tag: string, attributes: string) => {
			const blockStyle = tag.toLowerCase() === 'blockquote' ? COPY_BLOCK_STYLE : COPY_PARAGRAPH_STYLE;
			if (!/\bstyle\s*=/i.test(attributes)) {
				return `<${tag}${attributes} style="${blockStyle}">`;
			}
			const styled = attributes.replace(
				/\bstyle\s*=\s*(["'])(.*?)\1/i,
				(_styleMatch, quote: string, value: string) => {
					const existing = value.trim().replace(/;?\s*$/, '');
					return `style=${quote}${existing ? `${existing};` : ''}${blockStyle}${quote}`;
				},
			);
			return `<${tag}${styled}>`;
		},
	);
}
