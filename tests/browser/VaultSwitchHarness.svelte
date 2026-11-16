<script lang="ts">
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import VaultSwitchFrame from './VaultSwitchFrame.svelte';
	import { appConfig } from '../../src/lib/stores/app';
	import { applyLanguage } from '../../src/lib/i18n';
	import { isMobile } from '../../src/lib/platform';
	import { openVault, restoreExternalVault } from '../../src/lib/api';
	import { open as pickFolder } from '@tauri-apps/plugin-dialog';
	import { createVaultSwitch, activeVaultIdentity, mergeVaultActivation, vaultIdentityKey } from '../../src/lib/utils/vault-switch';
	import type { AppConfig, VaultConfig } from '../../src/lib/types';

	const a = { path: '/notes/Work', name: 'Work' }, b = { path: '/archive/Work', name: 'Work' };
	const vaults = [a, b, { path: '/home/user/Notes/Personal', name: 'Personal' }, { path: '/long/very-long-vault-folder/with-a-distinct-location', name: 'A very long vault name that must truncate in the title bar' }];
	appConfig.set({ active_vault: a.path, active_bookmark_id: null, vaults, show_note_switcher: false, theme: 'light', language: 'en' } as AppConfig);
	const saved = new Map(vaults.map(vault => [vault.path, `# ${vault.name}\n\nSaved note in ${vault.path}`]));
	let frame = $state<VaultSwitchFrame>();
	let busy = $state(false), managing = $state(false), mobile = $state(isMobile), dark = $state(false);
	let failSave = false, failOpen = false, holdOpen = false, folder: string | null = null;
	let resolveOpen: (() => void) | null = null;
	const calls: {command: string; args?: any}[] = [];
	const destroyed: { locked: boolean; owner: string }[] = [];
	let saves = 0;
	$effect(() => { document.documentElement.dataset.vaultDark = String(dark); });

	(window as any).__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
		calls.push({ command, args });
		if (command === 'plugin:window|is_maximized') return false;
		if (command === 'plugin:event|listen') return 1;
		if (command.startsWith('plugin:event|') || command.startsWith('plugin:window|')) return;
		if (command === 'plugin:dialog|open') return folder;
		if (command === 'open_vault' || command === 'restore_external_vault') {
			if (holdOpen) await new Promise<void>(resolve => { resolveOpen = resolve; });
			if (failOpen) throw 'Folder unavailable';
			const current = get(appConfig)!;
			if (JSON.stringify(args.expected) !== JSON.stringify(activeVaultIdentity(current))) throw 'Stale origin';
			let rows = [...current.vaults];
			let path: string = args.path;
			let bookmarkId: string | null = null;
			if (command === 'restore_external_vault') {
				bookmarkId = args.bookmarkId; path = `/resolved/${bookmarkId}`;
				rows = rows.map(vault => vault.bookmark_id === bookmarkId ? { ...vault, path } : vault);
			} else if (!rows.some(vault => vault.path === path)) {
				if (args.requireExisting) throw 'Vault no longer registered';
				rows.push({ path, name: path.split('/').at(-1) || path });
			}
			return { ...current, active_vault: path, active_bookmark_id: bookmarkId, vaults: rows };
		}
		throw new Error(`Unexpected native call: ${command}`);
	};
	const switcher = createVaultSwitch({
		current: () => activeVaultIdentity(get(appConfig)), busy: value => { busy = value; },
		acquire: async () => frame ? frame.acquire() : null,
		open: (target, expected) => target.bookmarkId ? restoreExternalVault(target.bookmarkId, expected) : openVault(target.path, { existing: target.existing, expected }),
		commit: async config => { appConfig.update(current => mergeVaultActivation(current, config)); await tick(); },
		manage: async () => { managing = true; await tick(); },
	});
	async function save(text: string) {
		saves++; if (failSave) return false;
		saved.set(get(appConfig)!.active_vault!, text); return true;
	}
	const add = () => mobile ? switcher.manage() : switcher.add(async () => {
		const path = await pickFolder({ directory: true, multiple: false });
		return typeof path === 'string' ? { path, bookmarkId: null, existing: false } : null;
	});
	Object.assign(window, { vaultFixture: {
		snapshot: () => ({ active: activeVaultIdentity(get(appConfig)), editor: frame?.snapshot(), busy, managing, saves, calls: [...calls], destroyed: [...destroyed] }),
		edit: (text: string) => frame?.edit(text),
		failSave: (value: boolean) => { failSave = value; }, failOpen: (value: boolean) => { failOpen = value; },
		hold: (value: boolean) => { holdOpen = value; }, release: () => resolveOpen?.(),
		folder: (value: string | null) => { folder = value; }, switchToB: () => switcher.switchTo(b),
		mobile: () => { mobile = true; }, dark: () => { dark = !dark; }, language: applyLanguage,
		back: () => { managing = false; },
		bookmarks: () => { appConfig.update(config => ({ ...config!, vaults: [...config!.vaults, { path: '/provider/A', name: 'Files A', bookmark_id: 'book-a' }, { path: '/provider/B', name: 'Files B', bookmark_id: 'book-b' }] })); },
	} });
</script>

<main>
	{#if managing}<h1>Vault management fixture</h1>
	{:else}
		{#key vaultIdentityKey(activeVaultIdentity($appConfig))}
			<VaultSwitchFrame bind:this={frame} owner={$appConfig!.active_vault!} initial={saved.get($appConfig!.active_vault!) ?? 'New vault'} {save}
				onselect={switcher.switchTo} onadd={add} onmanage={switcher.manage} {busy} {mobile} destroyed={(locked, owner) => destroyed.push({ locked, owner })} />
		{/key}
	{/if}
</main>

<style>
	:global(:root) { --bg-primary: #fff; --bg-secondary: #f3f5f7; --bg-hover: #e7edf0; --bg-tertiary: #e8edf0; --text-primary: #20252b; --text-secondary: #626e79; --text-tertiary: #79838d; --accent: #276e68; --accent-hover: #1f5e59; --border-color: #ced6dc; --editor-font-size: 16px; --editor-line-height: 1.6; }
	:global(:root[data-vault-dark='true']) { --bg-primary: #182027; --bg-secondary: #222d36; --bg-hover: #303d48; --bg-tertiary: #303d48; --text-primary: #e5eaf0; --text-secondary: #a1acb8; --text-tertiary: #8b99a6; --accent: #79c7b6; --border-color: #3c4b58; }
	:global(body) { margin: 0; font-family: sans-serif; color: var(--text-primary); background: var(--bg-primary); }
	main { height: 100vh; }
</style>
