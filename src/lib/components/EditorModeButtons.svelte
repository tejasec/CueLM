<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import type { EditorMode } from '$lib/editor/mode';
	let { value, onchange, disabled = false }: { value: EditorMode; onchange: (mode: EditorMode) => Promise<void>; disabled?: boolean } = $props();
	const group = $props.id();
	let root: HTMLDivElement;
	let pending = $state(false), error = $state('');
	let disposed = false;
	onDestroy(() => { disposed = true; });
	const options = $derived([
		{ value: 'rich' as const, label: $t('editorMode.rich') },
		{ value: 'live' as const, label: $t('editorMode.live') },
		{ value: 'source' as const, label: $t('editorMode.source') },
	]);
	async function choose(next: EditorMode) {
		// Radio DOM changes immediately; keep the saved value selected until persistence succeeds.
		for (const input of root.querySelectorAll<HTMLInputElement>('input')) input.checked = input.value === value;
		if (pending || disabled || next === value) return;
		const restore = root.contains(document.activeElement);
		pending = true; error = '';
		try { await onchange(next); }
		catch (cause) { if (!disposed) error = String(cause); }
		finally { if (!disposed) pending = false; }
		await tick();
		if (!disposed && restore && document.activeElement === document.body) root.querySelector<HTMLInputElement>('input:checked')?.focus();
	}
</script>

<div class="editor-mode-preference" bind:this={root} aria-busy={pending}>
	<fieldset role="radiogroup" aria-label={$t('editorMode.newNotes')} disabled={disabled || pending}>
		{#each options as option}
			<label>
				<input type="radio" name={group} value={option.value} checked={value === option.value} onchange={() => choose(option.value)} />
				<span>{option.label}</span>
			</label>
		{/each}
	</fieldset>
	{#if pending}<p role="status">{$t('ui.saving')}</p>{/if}
	{#if error}<p role="alert">{$t('editorMode.saveFailed', { error })}</p>{/if}
</div>

<style>
	.editor-mode-preference { min-width: 0; width: min(100%, 360px); }
	fieldset { display: flex; padding: 0; margin: 0; min-width: 0; border: 1px solid var(--border-color); border-radius: 7px; overflow: hidden; }
	label { position: relative; flex: 1; min-width: 0; display: flex; }
	label + label { border-inline-start: 1px solid var(--border-color); }
	input { position: absolute; width: 1px; height: 1px; opacity: 0; }
	span { display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; min-height: 38px; padding: 7px 10px; background: var(--bg-secondary); color: var(--text-secondary); font-size: 12px; line-height: 1.35; text-align: center; overflow-wrap: anywhere; cursor: pointer; }
	input:checked + span { background: var(--accent-light, var(--bg-hover)); color: var(--accent); font-weight: 600; }
	input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: -2px; }
	input:disabled + span { opacity: .6; cursor: wait; }
	p { margin: 8px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-secondary); overflow-wrap: anywhere; }
	@media (pointer: coarse) { span { min-height: 44px; } }
</style>
