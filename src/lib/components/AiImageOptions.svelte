<script lang="ts">
	import { t } from '$lib/i18n';
	import type { AiImageCandidate } from '$lib/utils/ai-media';
	let { images, selected = $bindable([]), destination }: { images: AiImageCandidate[]; selected: string[]; destination: string } = $props();
	function toggle(path: string, checked: boolean) {
		selected = checked ? [...selected, path].slice(0, 4) : selected.filter(item => item !== path);
	}
</script>

<section class="ai-image-options" aria-labelledby="ai-image-title">
	<h4 id="ai-image-title">{$t('ai.vision.title')}</h4>
	<p>{$t('ai.vision.help')}</p>
	{#if images.length}
		<div class="image-list">
			{#each images as image (image.path)}
				<label><input type="checkbox" checked={selected.includes(image.path)} disabled={selected.length >= 4 && !selected.includes(image.path)} onchange={(event) => toggle(image.path, event.currentTarget.checked)} /><span dir="auto">{image.name}</span></label>
			{/each}
		</div>
	{:else}<p>{$t('ai.vision.none')}</p>{/if}
	{#if selected.length}<p class="disclosure" role="status">{$t('ai.vision.privacy', { provider: destination, count: selected.length })}</p>{/if}
</section>

<style>
	.ai-image-options { margin: 6px 8px 8px; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; }
	h4 { margin: 0 0 6px; font-size: 13px; color: var(--text-primary); }
	p { margin: 6px 0; font-size: 12px; line-height: 1.5; color: var(--text-secondary); overflow-wrap: anywhere; }
	.image-list { max-height: 144px; overflow-y: auto; }
	label { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; color: var(--text-primary); cursor: pointer; }
	span { min-width: 0; overflow-wrap: anywhere; }
	input { appearance: none; flex-shrink: 0; width: 16px; height: 16px; border: 1px solid var(--border-color); border-radius: 3px; background: var(--bg-secondary); cursor: pointer; }
	input:checked { background: var(--accent); border-color: var(--accent); }
	input:checked::after { content: '✓'; display: block; text-align: center; line-height: 14px; color: var(--bg-primary); font-size: 12px; }
	input:disabled { opacity: .5; cursor: default; }
	input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.disclosure { color: var(--text-primary); }
</style>
