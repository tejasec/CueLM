import { EditorSelection, EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import MarkdownIt from 'markdown-it';

export interface LivePreviewOptions {
	resolveImage?: (href: string) => string;
	openLink?: (href: string) => void;
	checkboxLabel?: string;
	imageLabel?: string;
	/** Re-resolve assets after note/vault changes, even if the Markdown is identical. */
	context?: string;
}

export type PreviewSpan = {
	from: number; to: number;
	kind: 'line' | 'mark' | 'hide' | 'image' | 'checkbox' | 'bullet';
	className?: string; href?: string; label?: string; checked?: boolean;
};
const markdown = new MarkdownIt({ html: false });

/** Never interpret raw HTML or arbitrary URI schemes as preview content. */
export function previewDestination(raw: string): string | null {
	const href = markdown.utils.unescapeAll(raw.replace(/^<([\s\S]*)>$/, '$1'));
	if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
	if (/^[a-z]:[\\/]/i.test(href)) return href;
	if (/^[a-z][\w+.-]*:/i.test(href) && !/^(https?:|mailto:|asset:|imgproxy:|blob:)/i.test(href)
		&& !/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(href)) return null;
	return href;
}

/** Presentation only. Every coordinate still addresses the original Markdown document. */
export function previewSpans(state: EditorState, visible: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }], composing = false): PreviewSpan[] {
	const spans: PreviewSpan[] = [];
	const seen = new Set<string>();
	const selected = state.selection.ranges.map(range => ({
		from: state.doc.lineAt(range.from).from,
		to: state.doc.lineAt(range.to).to,
	}));
	const active = (from: number, to: number) => (!state.readOnly || composing) && selected.some(range => from <= range.to && to >= range.from);
	const shown = (from: number, to: number) => visible.some(range => from <= range.to && to >= range.from);
	const add = (span: PreviewSpan) => {
		if (!shown(span.from, span.to)) return;
		const key = `${span.kind}:${span.from}:${span.to}:${span.className ?? ''}`;
		if (!seen.has(key)) { seen.add(key); spans.push(span); }
	};
	const hide = (from: number, to: number) => { if (to > from) add({ from, to, kind: 'hide' }); };
	const lines = (from: number, to: number, className: string) => {
		for (const range of visible) {
			let line = state.doc.lineAt(Math.max(from, range.from));
			const end = Math.min(to, range.to);
			while (line.from <= end) {
				add({ from: line.from, to: line.from, kind: 'line', className });
				if (line.to >= state.doc.length) break;
				line = state.doc.lineAt(line.to + 1);
			}
		}
	};
	for (const range of visible) {
		let line = state.doc.lineAt(range.from);
		while (line.from <= range.to) {
			if (!active(line.from, line.to)) add({ from: line.from, to: line.from, kind: 'line', className: 'lp-rendered' });
			if (line.to >= state.doc.length) break;
			line = state.doc.lineAt(line.to + 1);
		}
	}
	for (const range of visible) syntaxTree(state).iterate({ from: range.from, to: range.to, enter(ref) {
		const node = ref.node;
		const { from, to, name } = node;
		// Complex constructs remain literal source, not unsafe HTML or a lossy rendering.
		if (name === 'HTMLBlock' || name === 'HTMLTag' || name === 'Table' || name === 'LinkReference'
			|| name === 'SourceMathBlock' || name === 'SourceMathInline') return false;
		if (name === 'Paragraph') {
			// Bound work for very long paragraphs; CodeMirror parses visible syntax incrementally.
			if (to - from > 30_000) return false;
		}
		if (name === 'FencedCode' || name === 'CodeBlock') {
			lines(from, to, 'lp-code-block');
			if (name === 'FencedCode' && !active(from, to)) {
				for (const mark of node.getChildren('CodeMark')) {
					const line = state.doc.lineAt(mark.from);
					hide(mark.from, line.to);
				}
			}
			return false;
		}
		const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
		if (heading) {
			const underline = name.startsWith('Setext') ? node.getChild('HeaderMark') : null;
			lines(from, underline ? state.doc.lineAt(underline.from).from - 1 : to, `lp-heading lp-h${heading[1]}`);
			if (!active(from, to)) for (const mark of node.getChildren('HeaderMark')) {
				let end = mark.to;
				while (state.sliceDoc(end, end + 1) === ' ') end++;
				hide(mark.from, end);
			}
		}
		if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough' || name === 'InlineCode') {
			const className = ({ StrongEmphasis: 'lp-strong', Emphasis: 'lp-emphasis', Strikethrough: 'lp-strike', InlineCode: 'lp-inline-code' })[name]!;
			add({ from, to, kind: 'mark', className });
			if (!active(from, to)) for (const mark of node.getChildren(name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark')) hide(mark.from, mark.to);
			if (name === 'InlineCode') return false;
		}
		if (name === 'Blockquote') lines(from, to, 'lp-quote');
		if (name === 'QuoteMark' && !active(from, to)) {
			hide(from, to + (state.sliceDoc(to, to + 1) === ' ' ? 1 : 0));
		}
		if (name === 'HorizontalRule' && !active(from, to)) {
			lines(from, to, 'lp-rule'); hide(from, to); return false;
		}
		if (name === 'ListMark' || name === 'TaskMarker') {
			const line = state.doc.lineAt(from);
			if (active(line.from, line.to)) return;
			if (name === 'TaskMarker') {
				const checked = /[xX]/.test(state.sliceDoc(from, to));
				add({ from, to, kind: 'checkbox', checked });
				if (checked && node.parent && node.parent.to > to) add({ from: to, to: node.parent.to, kind: 'mark', className: 'lp-task-done' });
			} else if (node.parent?.parent?.name === 'BulletList') {
				const tail = state.sliceDoc(to, Math.min(line.to, to + 8));
				if (/^\s+\[[ xX]\]/.test(tail)) hide(from, to + 1);
				else add({ from, to, kind: 'bullet' });
			}
		}
		if (name === 'Link' || name === 'Image') {
			if (to - from > 30_000) return false;
			const url = node.getChild('URL');
			if (!url) return false; // Wiki/reference links remain editable literal text.
			const href = previewDestination(state.sliceDoc(url.from, url.to));
			if (!href) return false;
			const marks = node.getChildren('LinkMark');
			const close = marks.find(mark => state.sliceDoc(mark.from, mark.to) === ']');
			if (!close || active(from, to)) return false;
			if (name === 'Image') {
				if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number || /^mailto:/i.test(href)) return false;
				add({ from, to, kind: 'image', href, label: state.sliceDoc(from + 2, close.from) });
				return false;
			}
			if (close.from <= from + 1) return false; // Empty labels must remain selectable source, not zero-length marks.
			hide(from, from + 1); hide(close.from, to);
			add({ from: from + 1, to: close.from, kind: 'mark', className: 'lp-link', href });
		}
	} });
	return spans;
}

class Bullet extends WidgetType {
	toDOM() { const span = document.createElement('span'); span.className = 'lp-bullet'; span.textContent = '•'; span.setAttribute('aria-hidden', 'true'); return span; }
}

class Checkbox extends WidgetType {
	readonly from: number;
	readonly checked: boolean;
	readonly readonly: boolean;
	readonly label: string;
	constructor(from: number, checked: boolean, readonly: boolean, label: string) {
		super(); this.from = from; this.checked = checked; this.readonly = readonly; this.label = label;
	}
	eq(other: Checkbox) { return this.from === other.from && this.checked === other.checked && this.readonly === other.readonly && this.label === other.label; }
	toDOM(view: EditorView) {
		const input = document.createElement('input');
		input.type = 'checkbox'; input.className = 'lp-checkbox'; input.checked = this.checked; input.disabled = this.readonly;
		input.dataset.sourceFrom = String(this.from);
		input.setAttribute('aria-label', this.label);
		input.onmousedown = event => event.preventDefault();
		input.onchange = () => {
			const from = Number(input.dataset.sourceFrom);
			const raw = view.state.sliceDoc(from, from + 3);
			if (view.state.readOnly || !/^\[[ xX]\]$/.test(raw)) { input.checked = /[xX]/.test(raw); return; }
			view.dispatch({ changes: { from: from + 1, to: from + 2, insert: raw[1] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
		};
		return input;
	}
	updateDOM(dom: HTMLElement) {
		if (!(dom instanceof HTMLInputElement)) return false;
		dom.dataset.sourceFrom = String(this.from); dom.checked = this.checked; dom.disabled = this.readonly;
		dom.setAttribute('aria-label', this.label);
		return true;
	}
	ignoreEvent() { return true; }
}

class PreviewImage extends WidgetType {
	readonly from: number;
	readonly to: number;
	readonly src: string;
	readonly alt: string;
	readonly label: string;
	constructor(from: number, to: number, src: string, alt: string, label: string) {
		super(); this.from = from; this.to = to; this.src = src; this.alt = alt; this.label = label;
	}
	eq(other: PreviewImage) { return this.from === other.from && this.to === other.to && this.src === other.src && this.alt === other.alt && this.label === other.label; }
	get estimatedHeight() { return 160; }
	toDOM(view: EditorView) {
		const button = document.createElement('button');
		button.type = 'button'; button.className = 'lp-image'; button.setAttribute('aria-label', this.label);
		button.dataset.sourceFrom = String(this.from); button.dataset.sourceTo = String(this.to); button.dataset.previewSrc = this.src;
		const image = document.createElement('img');
		image.alt = this.alt; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
		image.crossOrigin = 'anonymous';
		const fallback = document.createElement('span'); fallback.className = 'lp-image-fallback'; fallback.textContent = this.alt || this.label;
		image.onload = () => { fallback.hidden = true; if (button.isConnected) view.requestMeasure(); };
		image.onerror = () => { image.hidden = true; fallback.hidden = false; if (button.isConnected) view.requestMeasure(); };
		button.onmousedown = event => event.preventDefault();
		button.onclick = () => { view.dispatch({ selection: EditorSelection.single(Number(button.dataset.sourceFrom), Number(button.dataset.sourceTo)), scrollIntoView: true }); view.focus(); };
		button.append(image, fallback); image.src = this.src;
		return button;
	}
	updateDOM(dom: HTMLElement) {
		if (!(dom instanceof HTMLButtonElement) || dom.dataset.previewSrc !== this.src) return false;
		// Keep already loaded images stable while typing before them, but refresh source coordinates.
		dom.dataset.sourceFrom = String(this.from); dom.dataset.sourceTo = String(this.to);
		dom.setAttribute('aria-label', this.label);
		const image = dom.querySelector('img'); if (image) image.alt = this.alt;
		const fallback = dom.querySelector('.lp-image-fallback'); if (fallback) fallback.textContent = this.alt || this.label;
		return true;
	}
	destroy(dom: HTMLElement) { const image = dom.querySelector('img'); if (image) { image.onload = null; image.onerror = null; } }
	ignoreEvent() { return true; }
}

export function livePreview(options: LivePreviewOptions = {}): Extension {
	const plugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet = Decoration.none;
		atomic: DecorationSet = Decoration.none;
		constructor(view: EditorView) { this.build(view); }
		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.some(tr => tr.reconfigured)
				|| syntaxTree(update.state) !== syntaxTree(update.startState)) this.build(update.view);
		}
		build(view: EditorView) {
			const ranges: Range<Decoration>[] = [];
			for (const span of previewSpans(view.state, view.visibleRanges, view.composing)) {
				let decoration: Decoration;
				if (span.kind === 'line') decoration = Decoration.line({ attributes: { class: span.className! } });
				else if (span.kind === 'mark') decoration = Decoration.mark({ class: span.className!, attributes: span.href ? { 'data-preview-href': span.href, title: span.href } : undefined });
				else {
					let widget: WidgetType | undefined;
					if (span.kind === 'bullet') widget = new Bullet();
					if (span.kind === 'checkbox') widget = new Checkbox(span.from, !!span.checked, view.state.readOnly, options.checkboxLabel ?? 'Toggle task');
					if (span.kind === 'image') {
						let src: string;
						try { src = options.resolveImage?.(span.href!) ?? span.href!; } catch { continue; }
						widget = new PreviewImage(span.from, span.to, src, span.label!, options.imageLabel ?? 'Edit image source');
					}
					decoration = Decoration.replace({ widget, liveAtomic: true });
				}
				ranges.push(decoration.range(span.from, span.to));
			}
			this.decorations = Decoration.set(ranges, true);
			this.atomic = this.decorations.update({ filter: (_from, _to, decoration) => !!decoration.spec.liveAtomic });
		}
	}, { decorations: value => value.decorations, provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.atomic ?? Decoration.none) });
	return [plugin, EditorView.domEventHandlers({
		mousedown(event) {
			// Handle before CM moves the caret and reveals (removes) the decorated link.
			const link = (event.target as Element).closest?.('[data-preview-href]');
			if (!link || !(event.ctrlKey || event.metaKey) || !options.openLink) return false;
			event.preventDefault(); options.openLink(link.getAttribute('data-preview-href')!); return true;
		},
		keydown(event, view) {
			if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || !options.openLink || event.isComposing) return false;
			let node = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1);
			while (node.parent && node.name !== 'Link') node = node.parent;
			const url = node.name === 'Link' ? node.getChild('URL') : null;
			const href = url ? previewDestination(view.state.sliceDoc(url.from, url.to)) : null;
			if (!href) return false;
			event.preventDefault(); options.openLink(href); return true;
		},
	}), EditorView.theme({
		'&': { fontFamily: 'var(--editor-font-family, sans-serif)' },
		'.cm-scroller': { fontFamily: 'var(--editor-font-family, sans-serif)' },
		'.cm-line': { lineHeight: 'var(--editor-line-height, 1.6)' },
		'.lp-rendered span': { color: 'inherit' },
		'.lp-rendered .lp-link, .lp-rendered .lp-link span': { color: 'var(--accent)' },
		'.lp-rendered .lp-task-done, .lp-rendered .lp-task-done span': { color: 'var(--text-secondary)', textDecoration: 'line-through' },
		'.lp-heading': { fontWeight: '700', paddingTop: '0.45em', paddingBottom: '0.2em', lineHeight: '1.35' },
		'.lp-heading span': { color: 'var(--text-primary)' },
		'.lp-h1': { fontSize: '1.9em' }, '.lp-h2': { fontSize: '1.55em' }, '.lp-h3': { fontSize: '1.3em' },
		'.lp-h4': { fontSize: '1.15em' }, '.lp-h5, .lp-h6': { fontSize: '1em' },
		'.cm-line .lp-strong': { fontWeight: '700', color: 'var(--text-primary)' },
		'.cm-line .lp-emphasis': { fontStyle: 'italic', color: 'var(--text-primary)' },
		'.lp-strike': { textDecoration: 'line-through' },
		'.lp-inline-code': { fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-secondary)', borderRadius: '3px', padding: '1px 3px' },
		'.lp-code-block': { fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-secondary)' },
		'.lp-quote': { borderLeft: '3px solid var(--accent)', paddingLeft: '12px', color: 'var(--text-secondary)' },
		'.lp-rule': { borderBottom: '1px solid var(--border-color)' },
		'.lp-link': { color: 'var(--accent)', textDecoration: 'underline', cursor: 'text' },
		'.lp-bullet': { color: 'var(--accent)', fontWeight: '700' },
		'.lp-checkbox': { cursor: 'pointer', verticalAlign: 'middle', accentColor: 'var(--accent)', width: '16px', height: '16px', margin: '0 5px 0 0' },
		'.lp-image': { display: 'inline-block', border: '0', padding: '0', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', maxWidth: '100%', verticalAlign: 'middle' },
		'.lp-image img': { maxWidth: '100%', maxHeight: '360px', objectFit: 'contain', borderRadius: '4px' },
		'.lp-image:focus-visible': { outline: '2px solid var(--accent)' },
		'.lp-image-fallback': { fontSize: '0.9em', padding: '8px', border: '1px dashed var(--border-color)' },
		'@media (pointer: coarse)': { '.lp-checkbox': { width: '24px', height: '24px' } },
	})];
}
