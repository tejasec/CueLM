<script lang="ts">
	import { t as ui, tr as uiText } from '$lib/i18n';
	import { tick } from 'svelte';
	import SnapshotDocument from './SnapshotDocument.svelte';
	import { comparableBody, compareHistory, splitSnapshot, type HistoryComparison, type HistoryRow } from '$lib/utils/history-comparison';

	let { raw, current, selected, loading, error, canRestore, onRetry, onRestore, renderSnapshot }: {
		raw: string | null;
		current: string;
		selected: string | null;
		loading: boolean;
		error: string | null;
		canRestore: boolean;
		onRetry: () => void;
		onRestore: () => void;
		renderSnapshot: (body: string) => string;
	} = $props();

	let view = $state<'changes' | 'snapshot'>('changes');
	let source = $state(false);
	let comparison = $state<HistoryComparison | null>(null);
	let comparing = $state(false);
	let comparisonError = $state<string | null>(null);
	let request = 0;
	const snapshot = $derived(splitSnapshot(raw ?? ''));
	const rendered = $derived.by(() => {
		if (view !== 'snapshot' || source || raw === null) return { html: '', error: '' };
		try {
			return { html: renderSnapshot(snapshot.body), error: '' };
		} catch (cause) {
			return { html: '', error: `Could not render this snapshot: ${String(cause)}` };
		}
	});

	$effect(() => {
		const content = raw;
		const working = current;
		const body = snapshot.body;
		const generation = ++request;
		comparison = null;
		comparisonError = null;
		comparing = content !== null;
		if (content !== null) {
			compareHistory(comparableBody(working), comparableBody(body)).then((result) => {
				if (generation !== request) return;
				comparison = result;
			}).catch((cause) => {
				if (generation === request) comparisonError = uiText("ui.could_not_compare_this_version", { value0: String(cause) });
			}).finally(() => {
				if (generation === request) comparing = false;
			});
		}
		return () => { request++; };
	});

	async function navigateTabs(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		view = event.key === 'Home' ? 'changes' : event.key === 'End' ? 'snapshot' : view === 'changes' ? 'snapshot' : 'changes';
		await tick();
		document.getElementById(`history-tab-${view}`)?.focus();
	}
</script>

{#snippet lines(rows: HistoryRow[])}
	{#each rows as row}
		<div class="diff-line {row.kind}">
			<span class="line-number" aria-label={$ui("ui.current_note_line")}>{row.currentLine ?? ''}</span>
			<span class="line-number" aria-label={$ui("ui.snapshot_line")}>{row.snapshotLine ?? ''}</span>
			<span class="line-sign" aria-label={row.kind === 'added' ? $ui("ui.added_by_restoring") : row.kind === 'removed' ? $ui("ui.removed_by_restoring") : $ui("ui.unchanged")}>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</span>
			<span class="line-text">{row.text || ' '}{#if !row.newline}<span class="line-ending">{$ui("ui.no_final_newline")}</span>{/if}</span>
		</div>
	{/each}
{/snippet}

<section class="history-review" aria-label={$ui("ui.version_review")}>
	<div class="review-header">
		<div class="review-heading">
			<strong>{selected ?? 'Version History'}</strong>
			<span>{$ui("ui.read_only_your_current_note_stays_unchanged")}</span>
		</div>
		<div class="review-tabs" role="tablist" aria-label={$ui("ui.version_view")} tabindex="-1" onkeydown={navigateTabs}>
			<button id="history-tab-changes" role="tab" aria-selected={view === 'changes'} aria-controls="history-changes" tabindex={view === 'changes' ? 0 : -1} onclick={() => view = 'changes'}>{$ui("ui.changes")}</button>
			<button id="history-tab-snapshot" role="tab" aria-selected={view === 'snapshot'} aria-controls="history-snapshot" tabindex={view === 'snapshot' ? 0 : -1} onclick={() => view = 'snapshot'}>{$ui("ui.snapshot")}</button>
		</div>
	</div>

	{#if loading}
		<p class="review-status" role="status">{$ui("ui.loading_version")}</p>
	{:else if error}
		<div class="review-status" role="alert"><p>{error}</p><button class="review-button" onclick={onRetry}>{$ui("ui.retry")}</button></div>
	{:else if raw === null}
		<p class="review-status">{$ui("ui.select_a_version_to_review")}</p>
	{:else if view === 'changes'}
		<div id="history-changes" class="review-panel" role="tabpanel" aria-labelledby="history-tab-changes" tabindex="0">
			<div class="comparison-heading">
				<span>{$ui("ui.current_note_selected_version")}</span>
				{#if comparison}<span class="comparison-count"><span class="added-count">+{comparison.added}</span> <span class="removed-count">−{comparison.removed}</span> {$ui("ui.lines")}</span>{/if}
			</div>
			{#if comparing}
				<p class="review-status" role="status">{$ui("ui.comparing")}</p>
			{:else if comparisonError}
				<p class="review-status" role="alert">{comparisonError}</p>
			{:else if comparison && comparison.added === 0 && comparison.removed === 0}
				<p class="review-status">{$ui("ui.no_content_changes_metadata_is_not_restored")}</p>
			{:else if comparison}
				<div class="history-diff">
					{#key raw}
						{#each comparison.chunks as chunk}
							{#if chunk.kind === 'unchanged'}
								<details class="unchanged-lines"><summary>{$ui("ui.unchanged_9bc74a", { value0: chunk.rows.length, value1: chunk.rows.length === 1 ? 'line' : 'lines' })}</summary>{@render lines(chunk.rows)}</details>
							{:else}
								{@render lines(chunk.rows)}
							{/if}
						{/each}
					{/key}
				</div>
			{/if}
		</div>
	{:else}
		<div id="history-snapshot" class="review-panel" role="tabpanel" aria-labelledby="history-tab-snapshot" tabindex="0">
			<div class="snapshot-heading"><span>{$ui("ui.selected_snapshot")}</span><button class="source-toggle" aria-pressed={source} onclick={() => source = !source}>{source ? $ui("ui.rendered_view") : $ui("ui.view_source")}</button></div>
			{#if snapshot.body === ''}
				<p class="review-status">{$ui("ui.this_snapshot_is_empty")}</p>
			{:else if source}
				<textarea class="snapshot-source" readonly aria-label={$ui("ui.snapshot_markdown_read_only")} value={snapshot.body}></textarea>
			{:else if rendered.error}
				<p class="review-status" role="alert">{$ui("ui.view_source_to_inspect_the_stored_body", { value0: rendered.error })}</p>
			{:else}
				<SnapshotDocument html={rendered.html} />
			{/if}
		</div>
	{/if}

	{#if raw !== null && snapshot.metadata}
		<details class="history-metadata"><summary>{$ui("ui.metadata_not_restored")}</summary><pre>{snapshot.metadata}</pre></details>
	{/if}
	{#if selected}
		<div class="review-actions"><span>{$ui("ui.restore_replaces_the_current_note_s_content_only")}</span><button class="history-restore-btn" disabled={!canRestore} onclick={onRestore}>{$ui("ui.restore_this_version")}</button></div>
	{/if}
</section>

<style>
	.history-review { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--bg-primary); }
	.review-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; flex-wrap: wrap; }
	.review-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.review-heading strong { font-size: 13px; overflow-wrap: anywhere; }
	.review-heading > span { font-size: 12px; color: var(--text-secondary); }
	.review-tabs { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--border-color); border-radius: 6px; }
	.review-tabs button, .source-toggle, .review-button { padding: 6px 10px; border: none; border-radius: 4px; background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; }
	.review-tabs button[aria-selected="true"] { background: var(--accent-light); color: var(--accent); }
	.review-tabs button:focus-visible, .source-toggle:focus-visible, .review-button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.review-panel { flex: 1; min-height: 0; overflow: auto; outline-offset: -2px; }
	.review-panel:focus-visible { outline: 2px solid var(--accent); }
	.comparison-heading, .snapshot-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 16px; font-size: 12px; color: var(--text-secondary); border-bottom: 1px solid var(--border-light); flex-wrap: wrap; }
	.comparison-count { font-family: var(--font-mono, monospace); }
	.added-count { color: var(--success); } .removed-count { color: var(--danger, #dc2626); }
	.review-status { margin: 0; padding: 20px 16px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
	.review-button { margin-top: 8px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); }
	.history-diff { padding: 8px 0; font-family: var(--font-mono, monospace); font-size: 12px; line-height: 1.6; }
	.diff-line { display: grid; grid-template-columns: 3.5em 3.5em 1.6em minmax(0, 1fr); align-items: start; padding: 1px 12px 1px 4px; }
	.diff-line.added { background: color-mix(in srgb, var(--success) 12%, var(--bg-primary)); }
	.diff-line.removed { background: color-mix(in srgb, var(--danger, #dc2626) 12%, var(--bg-primary)); }
	.line-number { padding-right: 8px; text-align: right; color: var(--text-tertiary); user-select: none; font-size: 10px; }
	.line-sign { color: var(--text-secondary); user-select: none; }
	.added .line-sign { color: var(--success); } .removed .line-sign { color: var(--danger, #dc2626); }
	.line-text { white-space: pre-wrap; overflow-wrap: anywhere; }
	.line-ending { display: block; color: var(--text-secondary); font-style: italic; font-size: 10px; }
	.unchanged-lines > summary { padding: 7px 16px; color: var(--text-secondary); background: var(--bg-secondary); cursor: pointer; font-family: var(--font-sans, inherit); font-size: 12px; }
	.snapshot-source { display: block; width: 100%; min-height: 100%; margin: 0; padding: 16px; resize: none; border: none; background: var(--bg-primary); color: var(--text-primary); font-family: var(--font-mono, monospace); font-size: 13px; line-height: 1.6; }
	.snapshot-source:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	.history-metadata { flex-shrink: 0; border-top: 1px solid var(--border-light); font-size: 12px; color: var(--text-secondary); max-height: 30%; overflow: auto; }
	.history-metadata > summary { cursor: pointer; padding: 8px 16px; }
	.history-metadata pre { margin: 0; padding: 0 16px 12px; font-family: var(--font-mono, monospace); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
	.review-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--border-light); background: var(--bg-secondary); flex-shrink: 0; flex-wrap: wrap; }
	.review-actions > span { font-size: 11px; color: var(--text-secondary); }
	.history-restore-btn { padding: 8px 14px; border: 1px solid var(--accent); border-radius: 6px; color: var(--accent); background: var(--accent-light); font-size: 12px; font-weight: 500; cursor: pointer; }
	.history-restore-btn:hover:not(:disabled) { background: var(--accent); color: var(--bg-primary); }
	.history-restore-btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.history-restore-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	@media (max-width: 600px) {
		.review-header { padding: 10px 12px; }
		.review-tabs { width: 100%; }
		.review-tabs button { flex: 1; min-height: 44px; }
		.source-toggle, .review-button, .history-restore-btn { min-height: 44px; }
		.diff-line { grid-template-columns: 2.8em 2.8em 1.4em minmax(0, 1fr); padding-right: 8px; }
		.review-actions { padding: 10px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
		.review-actions > span, .history-restore-btn { width: 100%; }
	}
</style>
