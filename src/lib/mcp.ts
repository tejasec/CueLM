import { tick } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { createMcpWindowGate, mcpBusy, type McpFinish } from './utils/mcp-editor';
import type { VaultIdentity } from './types';
import { isMobile } from './platform';

export type McpAccess = 'off' | 'read' | 'write';
export interface McpStatus { mode: McpAccess; ready: boolean; error?: string | null }
export const getMcpStatus = (vault: VaultIdentity) => invoke<McpStatus>('mcp_status', { vault });
export const setMcpAccess = (vault: VaultIdentity, mode: McpAccess) => invoke<McpStatus>('mcp_set_access', { vault, mode });
export const getMcpClientConfig = (vault: VaultIdentity) => invoke<Record<string, unknown>>('mcp_client_config', { vault });

export async function installMcpWindow(ready: () => boolean): Promise<() => void> {
	// Mobile binaries do not contain an MCP runtime or its native commands.
	if (isMobile) return () => {};
	let focused: HTMLElement | null = null;
	const gate = createMcpWindowGate({ ready, reply: (id, accepted) => invoke('mcp_editor_ready', { id, accepted }),
		busy(value) {
			if (value) focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			mcpBusy.set(value);
			if (!value) {
				const restore = focused; focused = null;
				void tick().then(() => { if (!get(mcpBusy) && restore?.isConnected && document.activeElement === document.body) restore.focus({ preventScroll: true }); });
			}
		}
	});
	const remove: (() => void)[] = [];
	let prepared: McpFinish | null = null;
	const report = (error: unknown) => console.error('MCP editor gate:', error);
	try {
		remove.push(await listen<McpFinish>('mcp-prepare', event => {
			if (!gate.requestId) prepared = event.payload;
			void gate.prepare(event.payload.id).catch(report);
		}));
		remove.push(await listen<McpFinish>('mcp-finish', event => {
			if (prepared?.id === event.payload.id) prepared = null;
			void gate.finish(event.payload).catch(report);
		}));
		// A reloaded webview must not become editable while a previously accepted
		// native write is still running. Keep startup on its loading screen until
		// the native owner confirms completion, then load fresh note data normally.
		const existing = await invoke<McpFinish | null>('mcp_active_request');
		if (existing) {
			mcpBusy.set(true);
			try {
				while (await invoke<boolean>('mcp_request_state', { id: existing.id })) await new Promise(resolve => setTimeout(resolve, 250));
			} finally { mcpBusy.set(false); }
		}
	} catch (error) { remove.forEach(fn => fn()); await gate.dispose(); throw error; }
	// Never unlock on a guessed timeout. Recover a lost finish event only when
	// the native owner confirms the disk operation has finished.
	let polling = false;
	const watchdog = setInterval(async () => {
		const request = prepared;
		if (polling || !request || gate.requestId !== request.id) return;
		polling = true;
		try {
			if (!(await invoke<boolean>('mcp_request_state', { id: request.id })) && prepared?.id === request.id) {
				prepared = null; await gate.finish(request);
			}
		} catch (error) { report(error); }
		finally { polling = false; }
	}, 3000);
	const block = (event: Event) => { if (get(mcpBusy)) { event.preventDefault(); event.stopImmediatePropagation(); } };
	for (const type of ['keydown', 'pointerdown', 'click', 'auxclick']) window.addEventListener(type, block, true);
	return () => {
		clearInterval(watchdog);
		remove.forEach(fn => fn());
		for (const type of ['keydown', 'pointerdown', 'click', 'auxclick']) window.removeEventListener(type, block, true);
		void gate.dispose();
	};
}
