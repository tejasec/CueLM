import { mount } from 'svelte';
import LivePreviewHarness from './LivePreviewHarness.svelte';

const fixture = new URLSearchParams(location.search).get('fixture');
if (fixture === 'vault' || fixture === 'preference' || fixture === 'mcp' || fixture === 'mcp-editor') {
	Object.assign(window, {
		__TAURI_INTERNALS__: { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
			transformCallback: () => 1, unregisterCallback: () => {}, invoke: async () => undefined },
		__TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
	});
	if (fixture === 'vault') {
		const { default: VaultSwitchHarness } = await import('./VaultSwitchHarness.svelte');
		mount(VaultSwitchHarness, { target: document.getElementById('app')! });
	} else if (fixture === 'mcp') {
		const { default: McpSettingsHarness } = await import('./McpSettingsHarness.svelte');
		mount(McpSettingsHarness, { target: document.getElementById('app')! });
	} else if (fixture === 'mcp-editor') {
		const { default: McpEditorHarness } = await import('./McpEditorHarness.svelte');
		mount(McpEditorHarness, { target: document.getElementById('app')! });
	} else {
		const { default: EditorPreferenceHarness } = await import('./EditorPreferenceHarness.svelte');
		mount(EditorPreferenceHarness, { target: document.getElementById('app')! });
	}
} else mount(LivePreviewHarness, { target: document.getElementById('app')! });
