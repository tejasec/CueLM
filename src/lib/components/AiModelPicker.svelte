<script lang="ts">
	import { t } from '$lib/i18n';
	import { fetchAiModels, type AiModel } from '$lib/api';
	import ThemedSelect from './ThemedSelect.svelte';
	let { provider, apiKey, value, onchange }: { provider: string; apiKey: string; value: string; onchange: (model: string) => Promise<void> } = $props();
	const owner = $derived(provider);
	const key = $derived(apiKey.trim());
	const model = $derived(value);
	let models = $state<AiModel[]>([]);
	let loading = $state(false);
	let fetched = $state(false);
	let error = $state('');
	let draft = $state('');
	let generation = 0;
	$effect(() => { draft = model; });
	async function refresh() {
		const request = ++generation;
		const p = owner, k = key;
		if (!k) return;
		loading = true; error = '';
		try {
			const result = await fetchAiModels(p, k);
			if (request !== generation) return;
			models = result; fetched = true;
		} catch (cause) { if (request === generation) error = String(cause); }
		finally { if (request === generation) loading = false; }
	}
	$effect(() => {
		owner; key;
		generation++; models = []; fetched = false; error = ''; loading = false;
		// Debounce key entry. Never cache credentials or automatically choose a paid model.
		const timer = key ? setTimeout(() => void refresh(), 800) : null;
		return () => { generation++; if (timer !== null) clearTimeout(timer); };
	});
	async function choose(next: string) {
		const p = owner, k = key;
		try { await onchange(next.trim()); }
		catch (cause) { if (p === owner && k === key) { error = String(cause); draft = next.trim(); } }
	}
	const options = $derived([
		...(model && !models.some(item => item.id === model) ? [{ value: model, label: `${model} (${$t('ai.models.saved')})` }] : []),
		...models.map(item => ({ value: item.id, label: item.name === item.id ? item.id : `${item.name} · ${item.id}` })),
	]);
</script>

<div class="ai-model-picker">
	<p class="hint">{$t('ai.models.help')}</p>
	{#if options.length}<ThemedSelect id="ai-provider-model" label={$t('ui.model')} value={model} {options} onchange={choose} />{/if}
	<button type="button" id="ai-models-refresh" disabled={loading || !key} onclick={refresh}>{$t(loading ? 'ai.models.loading' : 'ai.models.refresh')}</button>
	{#if !key}<p class="hint">{$t('ai.models.needKey')}</p>{/if}
	{#if fetched && !models.length}<p class="hint" role="status">{$t('ai.models.empty')}</p>{/if}
	{#if error}<p class="hint" role="alert">{$t('ai.models.failed', { error })}</p>{/if}
	<label for="ai-manual-model">{$t('ai.models.manual')}</label>
	<input id="ai-manual-model" type="text" maxlength="512" bind:value={draft} placeholder={$t('ui.enter_model_name')} onblur={() => { if (draft.trim() !== model) void choose(draft); }} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void choose(draft); } }} />
</div>

<style>
	.hint { margin: 8px 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
	label { display: block; margin: 12px 0 6px; color: var(--text-primary); font-size: 13px; }
	input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); font: inherit; font-size: 13px; }
	button { margin-top: 8px; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); font: inherit; font-size: 13px; cursor: pointer; }
	button:disabled { opacity: .6; cursor: default; }
	button:hover:not(:disabled) { background: var(--bg-hover); }
	button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
