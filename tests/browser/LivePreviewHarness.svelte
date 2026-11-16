<script lang="ts">
	import SourceEditor from '../../src/lib/components/SourceEditor.svelte';
	import EditorModePicker from '../../src/lib/components/EditorModePicker.svelte';
	import { SourceController } from '../../src/lib/editor/source/controller';
	import { sourceMode, livePreviewMode, selectEditorMode } from '../../src/lib/editor/mode';
	import { applyLanguage } from '../../src/lib/i18n';
	const initial = 'Edit here\n\n# Heading\n\n**bold** and *italic* and ~~gone~~ and `code`\n\n[Example](https://example.org)\n\n- [ ] First task\n- [x] Second task\n\n![sample](sample.png)\n\n```js\nconst value = "**literal**";\n```\n\n> Quoted text\n\nLast line';
	let edits = 0;
	let readonly = $state(false);
	let context = $state('first');
	let dark = $state(false);
	$effect(() => { document.documentElement.dataset.previewDark = String(dark); });
	const opened: string[] = [];
	const controller = new SourceController((_changes, edited) => { if (edited) edits++; });
	controller.load(initial);
	selectEditorMode('live');
	const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 180;
	const drawing = canvas.getContext('2d')!;
	drawing.fillStyle = '#d6e8e3'; drawing.fillRect(0, 0, 480, 180);
	drawing.fillStyle = '#264e47'; drawing.font = '24px sans-serif'; drawing.fillText('Local image preview', 30, 80);
	drawing.font = '16px sans-serif'; drawing.fillText('Select to edit its Markdown', 30, 116);
	const image = canvas.toDataURL();
	const resolveImage = () => image;
	const openLink = (href: string) => { opened.push(href); };
	Object.assign(window, { previewFixture: {
		initial,
		snapshot: () => ({ text: controller.state.doc.toString(), anchor: controller.state.selection.main.anchor, head: controller.state.selection.main.head, edits, opened: [...opened], view: !!controller.view }),
		select: (from: number, to = from) => { controller.select(from, to); controller.focus(); },
		mode: selectEditorMode,
		insert: (text: string) => controller.replace(text, controller.state.selection.main.from, controller.state.selection.main.to),
		undo: () => controller.undo(), redo: () => controller.redo(),
		readOnly: (value: boolean) => { readonly = value; },
		language: applyLanguage,
		context: (value: string) => { context = value; },
		dark: () => { dark = !dark; },
		load: (text: string) => { controller.load(text); },
		reveal: (from: number) => { controller.select(from, from, true); },
		top: () => controller.view?.lineBlockAtHeight(controller.view.scrollDOM.scrollTop).from,
	} });
</script>

<main>
	<header><span>Live Preview regression fixture</span><EditorModePicker id="fixture-mode" /></header>
	<section>
		<SourceEditor {controller} {readonly} visible={$sourceMode} preview={$livePreviewMode} {resolveImage} {openLink} {context} numbers />
	</section>
</main>

<style>
	:global(body) { margin: 0; font-family: sans-serif; }
	:global(:root) { --text-primary: #20242a; --text-secondary: #69737d; --bg-primary: #fff; --bg-secondary: #f3f5f6; --bg-hover: #e8edf0; --accent: #26706e; --border-color: #c9d0d4; --editor-font-size: 16px; --editor-font-family: sans-serif; --editor-line-height: 1.7; --editor-scroll-past-end: 30vh; --success: #237448; }
	main { height: 100vh; background: var(--bg-primary); color: var(--text-primary); display: flex; flex-direction: column; }
	:global(:root[data-preview-dark='true']) { --text-primary: #e5eaf0; --text-secondary: #9aa8b5; --bg-primary: #182027; --bg-secondary: #222d36; --bg-hover: #303d48; --border-color: #3c4b58; --accent: #79c7b6; }
	header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--border-color); }
	section { flex: 1; min-height: 0; padding: 18px; }
</style>
