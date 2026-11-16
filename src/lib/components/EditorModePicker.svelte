<script lang="ts">
	import { t } from '$lib/i18n';
	import { editorMode, selectEditorMode, type EditorMode } from '$lib/editor/mode';
	import ThemedSelect from './ThemedSelect.svelte';
	let { id, disabled = false }: { id: string; disabled?: boolean } = $props();
	const options = $derived([
		{ value: 'rich', label: $t('editorMode.rich') },
		{ value: 'live', label: $t('editorMode.live') },
		{ value: 'source', label: $t('editorMode.source') },
	]);
</script>

<ThemedSelect {id} label={$t('editorMode.label')} {options} value={$editorMode} {disabled} compact onchange={value => selectEditorMode(value as EditorMode)} />
