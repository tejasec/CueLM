<script lang="ts">
	import { t } from '$lib/i18n';
	import type { EditorMode } from '$lib/editor/mode';
	import EditorModeButtons from './EditorModeButtons.svelte';
	let { value, onchange }: { value: EditorMode; onchange: (mode: EditorMode) => Promise<void> } = $props();
</script>

<div class="new-note-editor-setting">
	<div class="preference-copy">
		<span class="preference-name">{$t('editorMode.newNotes')}</span>
		<span class="preference-description">{$t('editorMode.newNotesHelp')}</span>
	</div>
	<EditorModeButtons {value} {onchange} />
</div>

<style>
	.new-note-editor-setting { display: flex; flex-direction: column; align-items: stretch; gap: 12px; width: 100%; min-width: 0; box-sizing: border-box; padding: 16px 0 10px; margin-top: 12px; border-top: 1px solid var(--border-light, var(--border-color)); }
	.preference-copy { display: flex; flex-direction: column; gap: 3px; width: 100%; min-width: 0; }
	.preference-name { color: var(--text-primary); font-size: 13px; font-weight: 500; }
	.preference-description { color: var(--text-tertiary, var(--text-secondary)); font-size: 11px; line-height: 1.4; }
</style>
