<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { t as ui } from '$lib/i18n';
	import type { SourceController } from '$lib/editor/source/controller';

	let { controller, readonly = false, numbers = false, visible = true, mobile = false, preview = false, resolveImage, openLink, context = '' }: {
		controller: SourceController;
		readonly?: boolean;
		numbers?: boolean;
		visible?: boolean;
		mobile?: boolean;
		preview?: boolean;
		resolveImage?: (href: string) => string;
		openLink?: (href: string) => void;
		context?: string;
	} = $props();
	let host: HTMLDivElement;
	onMount(() => {
		const detach = controller.attach(host);
		const measure = () => controller.view?.requestMeasure();
		const appearance = new MutationObserver(measure);
		appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
		document.fonts.addEventListener('loadingdone', measure);
		return () => {
			appearance.disconnect();
			document.fonts.removeEventListener('loadingdone', measure);
			detach();
		};
	});
	$effect(() => {
		const settings = { readonly, numbers };
		untrack(() => controller.configure(settings.readonly, settings.numbers));
	});
	$effect(() => {
		const placeholder = $ui('source.placeholder'), label = $ui(preview ? 'editorMode.live' : 'source.label');
		untrack(() => controller.setLabels(placeholder, label));
	});
	$effect(() => {
		const enabled = preview && visible;
		const options = { resolveImage, openLink, context,
			checkboxLabel: $ui('livePreview.toggleTask'), imageLabel: $ui('livePreview.editImage') };
		// Renderer callbacks must not subscribe this effect to unrelated note/config stores.
		untrack(() => controller.setLivePreview(enabled, options));
	});
	$effect(() => { if (visible) controller.view?.requestMeasure(); });
</script>

<div class="source-editor" class:mobile class:live-preview={preview} class:with-line-numbers={numbers && !preview} style:display={visible ? undefined : 'none'} bind:this={host}></div>

<style>
	.source-editor {
		width: 100%;
		height: 100%;
		min-height: 0;
		max-width: var(--editor-content-width, none);
		margin: 0 auto;
		user-select: text;
	}
	.source-editor.with-line-numbers { max-width: none; }
	.source-editor.mobile :global(.cm-editor) { font-size: var(--editor-font-size, 15px); }
	.source-editor.mobile :global(.cm-content) { padding: 8px 16px max(220px, var(--editor-scroll-past-end, 65vh)); }
</style>
