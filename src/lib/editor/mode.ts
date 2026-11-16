import { derived, writable } from 'svelte/store';

export type EditorMode = 'rich' | 'live' | 'source';
// Source and Live Preview use one source controller; this flag only changes its presentation.
// Preferences are per window/session, matching the existing source-mode behaviour.
export const sourceMode = writable(false);
export const livePreviewMode = writable(false);
export const editorMode = derived([sourceMode, livePreviewMode], ([$source, $live]): EditorMode =>
	$source ? ($live ? 'live' : 'source') : 'rich');

export function newNoteEditorMode(config: { new_note_editor_mode?: unknown; new_notes_in_source_mode?: unknown } | null | undefined): EditorMode {
	const mode = config?.new_note_editor_mode;
	return mode === 'rich' || mode === 'live' || mode === 'source' ? mode
		: config?.new_notes_in_source_mode === true ? 'source' : 'rich';
}

export function selectEditorMode(mode: EditorMode): void {
	if (mode !== 'rich' && mode !== 'live' && mode !== 'source') return;
	if (mode !== 'rich') livePreviewMode.set(mode === 'live');
	sourceMode.set(mode !== 'rich');
}
