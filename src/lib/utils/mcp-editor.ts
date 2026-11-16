import { writable } from 'svelte/store';
import { suspendNoteNavigation } from './note-navigation.ts';

export interface McpFinish { id: string; vaultPath: string; path: string }
export type McpRelease = (finish: McpFinish) => Promise<void>;
type Acquire = () => Promise<McpRelease | null>;
let editor: { acquire: Acquire; ready: () => boolean } | null = null;
let readiness: (() => boolean) | null = null;
export const mcpBusy = writable(false);
export function mcpWindowReady(): boolean { return readiness?.() ?? false; }
export function registerMcpReadiness(ready: () => boolean): () => void {
	readiness = ready;
	return () => { if (readiness === ready) readiness = null; };
}
export function registerMcpEditor(acquire: Acquire, ready: () => boolean = () => true): () => void {
	const owner = { acquire, ready }; editor = owner;
	return () => { if (editor === owner) editor = null; };
}

/** One window-wide gate, including menus portaled outside the inert app root. */
export function createMcpWindowGate(options: {
	ready: () => boolean; reply: (id: string, accepted: boolean) => Promise<void>;
	acquire?: Acquire; busy?: (busy: boolean) => void;
}) {
	type Request = { id: string; release: McpRelease | null; finish: McpFinish | null; resume: () => void; completion: Promise<void> | null };
	let current: Request | null = null, disposed = false;
	const busy = options.busy ?? (value => mcpBusy.set(value));
	function complete(request: Request, finish: McpFinish): Promise<void> {
		request.completion ??= (async () => {
			try { await request.release?.(finish); }
			finally { request.resume(); if (current === request) { current = null; busy(false); } }
		})();
		return request.completion;
	}
	return {
		get requestId() { return current?.id ?? null; },
		async prepare(id: string) {
			if (disposed || !/^[a-f0-9]{32}$/.test(id)) return;
			// Reject dirty/IME states before inert/input blocking can disrupt them.
			if (current || !options.ready() || (!options.acquire && editor && !editor.ready())) { await options.reply(id, false); return; }
			const request: Request = { id, release: null, finish: null, resume: suspendNoteNavigation(), completion: null };
			current = request; busy(true);
			try {
				const acquire = options.acquire ?? editor?.acquire;
				request.release = acquire ? await acquire() : async () => {};
				if (request.finish || disposed) {
					await complete(request, request.finish ?? { id, vaultPath: '', path: '' }); return;
				}
				if (!request.release) { await options.reply(id, false); await complete(request, { id, vaultPath: '', path: '' }); return; }
				await options.reply(id, true);
			} catch {
				try { await options.reply(id, false); } finally { await complete(request, { id, vaultPath: '', path: '' }); }
			}
		},
		async finish(finish: McpFinish) {
			if (current?.id !== finish.id) return;
			current.finish = finish;
			if (current.release) await complete(current, finish);
		},
		async dispose() {
			disposed = true;
			if (current) {
				current.finish ??= { id: current.id, vaultPath: '', path: '' };
				if (current.release) await complete(current, current.finish);
			}
		},
	};
}
