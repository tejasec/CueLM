<script lang="ts">
	import { t } from '$lib/i18n';
	import { getDailyNoteTemplate, setDailyNoteTemplate, importDailyNoteTemplate, type DailyNoteTemplate } from '$lib/api';

	let { vaultPath }: { vaultPath: string } = $props();
	// Parent store updates (e.g. a language change) must not reset an in-progress draft.
	const currentVault = $derived(vaultPath);
	let value = $state<DailyNoteTemplate>({ raw: null, content: '', enabled: false });
	let loaded = $state(false);
	let loading = $state(false);
	let busy = $state(false);
	let editing = $state(false);
	let draft = $state('');
	let message = $state<'dailyTemplate.saved' | 'dailyTemplate.disabled' | null>(null);
	let error = $state<{ key: 'dailyTemplate.loadFailed' | 'dailyTemplate.saveFailed' | 'dailyTemplate.importFailed'; detail: string } | null>(null);
	let generation = 0;

	async function load(vault: string) {
		const request = ++generation;
		loading = true;
		loaded = false;
		error = null;
		try {
			const next = await getDailyNoteTemplate(vault);
			if (request !== generation) return;
			value = next;
			loaded = true;
		} catch (cause) {
			if (request === generation) error = { key: 'dailyTemplate.loadFailed', detail: String(cause) };
		} finally { if (request === generation) loading = false; }
	}

	$effect(() => {
		const vault = currentVault;
		value = { raw: null, content: '', enabled: false };
		editing = false;
		draft = '';
		busy = false;
		message = null;
		void load(vault);
		return () => { generation++; };
	});

	function edit() {
		draft = value.raw === null ? '# {{title}}\n\n' : value.content;
		error = null;
		message = null;
		editing = true;
	}

	async function save(template: string | null) {
		if (!loaded || busy) return;
		const request = generation;
		const vault = vaultPath;
		busy = true;
		error = null;
		message = null;
		try {
			const next = await setDailyNoteTemplate(vault, template, value.raw);
			if (request !== generation) return;
			value = next;
			editing = false;
			message = template === null ? 'dailyTemplate.disabled' : 'dailyTemplate.saved';
		} catch (cause) {
			if (request === generation) error = { key: 'dailyTemplate.saveFailed', detail: String(cause) };
		} finally { if (request === generation) busy = false; }
	}

	async function importFile() {
		if (!loaded || busy || editing) return;
		const request = generation;
		const vault = vaultPath;
		busy = true;
		error = null;
		message = null;
		try {
			const next = await importDailyNoteTemplate(vault, $t('dailyTemplate.import'), value.raw);
			if (request !== generation || next === null) return; // File picker cancelled.
			value = next;
			message = 'dailyTemplate.saved';
		} catch (cause) {
			if (request === generation) error = { key: 'dailyTemplate.importFailed', detail: String(cause) };
		} finally { if (request === generation) busy = false; }
	}
</script>

<section class="daily-template" aria-labelledby="daily-template-title" aria-busy={loading || busy}>
	<h3 id="daily-template-title">{$t('dailyTemplate.title')}</h3>
	<p class="description">{$t('dailyTemplate.description')}</p>
	<p class="description">{$t('dailyTemplate.tokens', { dateToken: '{{date}}', titleToken: '{{title}}' })}</p>
	{#if loading}
		<p class="description" role="status">{$t('ui.loading')}</p>
	{:else if loaded}
		<p class="status">{$t(value.enabled ? 'dailyTemplate.enabled' : value.raw === null ? 'dailyTemplate.none' : 'dailyTemplate.disabled')}</p>
		<div class="actions">
			<button type="button" id="daily-template-import" disabled={busy || editing} onclick={importFile}>{$t('dailyTemplate.import')}</button>
			<button type="button" id="daily-template-edit" disabled={busy || editing} onclick={edit}>{$t(value.raw === null ? 'dailyTemplate.create' : 'ui.edit')}</button>
			{#if value.raw !== null}
				<button type="button" id="daily-template-toggle" disabled={busy || editing} onclick={() => save(value.enabled ? null : value.content)}>{$t(value.enabled ? 'dailyTemplate.disable' : 'dailyTemplate.enable')}</button>
			{/if}
			<button type="button" id="daily-template-reload" disabled={busy || editing} onclick={() => { message = null; void load(vaultPath); }}>{$t('ui.reload_from_disk')}</button>
		</div>
	{/if}
	{#if editing}
		<label for="daily-template-editor">{$t('dailyTemplate.editorLabel')}</label>
		<textarea id="daily-template-editor" bind:value={draft} disabled={busy} rows="10" spellcheck="false" placeholder={$t('dailyTemplate.placeholder')}></textarea>
		<div class="actions">
			<button type="button" id="daily-template-save" disabled={busy} onclick={() => save(draft)}>{$t(busy ? 'ui.saving' : 'ui.save')}</button>
			<button type="button" id="daily-template-cancel" disabled={busy} onclick={() => { editing = false; error = null; }}>{$t('ui.cancel')}</button>
		</div>
	{/if}
	{#if error}
		<p class="error" role="alert">{$t(error.key, { error: error.detail })}</p>
		{#if !loaded}<button type="button" disabled={loading} onclick={() => load(vaultPath)}>{$t('ui.retry')}</button>{/if}
	{/if}
	{#if message}<p class="description" role="status">{$t(message)}</p>{/if}
	<p class="location">{$t('dailyTemplate.storage')} <code>.helixnotes/daily-template.md</code></p>
</section>

<style>
	.daily-template { margin-bottom: 24px; }
	h3 { margin-bottom: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
	.description, .location { margin: 8px 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
	.status { margin: 12px 0; font-size: 13px; color: var(--text-primary); }
	.actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
	button { min-width: 0; max-width: 100%; min-height: 36px; overflow-wrap: anywhere; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); font: inherit; font-size: 13px; cursor: pointer; }
	button:hover:not(:disabled) { background: var(--bg-hover); }
	button:disabled { opacity: 0.6; cursor: default; }
	button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	label { display: block; margin: 12px 0 8px; font-size: 13px; color: var(--text-primary); }
	textarea { display: block; width: 100%; min-height: 180px; box-sizing: border-box; resize: vertical; border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; background: var(--bg-secondary); color: var(--text-primary); font-family: var(--font-mono, monospace); font-size: 13px; line-height: 1.6; }
	.error { margin-top: 8px; color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
	.location { overflow-wrap: anywhere; }
	code { font-size: 12px; white-space: normal; }
</style>
