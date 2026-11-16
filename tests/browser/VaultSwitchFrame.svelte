<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import TitleBar from '../../src/lib/components/TitleBar.svelte';
	import VaultSwitcher from '../../src/lib/components/VaultSwitcher.svelte';
	import SourceEditor from '../../src/lib/components/SourceEditor.svelte';
	import { SourceController } from '../../src/lib/editor/source/controller';
	import { appConfig, editorDirty } from '../../src/lib/stores/app';
	import { activeVaultIdentity, type VaultSwitchResult } from '../../src/lib/utils/vault-switch';
	import type { VaultConfig } from '../../src/lib/types';

	let { owner, initial, save, onselect, onadd, onmanage, busy, mobile, destroyed }: {
		owner: string; initial: string; save: (text: string) => Promise<boolean>;
		onselect: (vault: VaultConfig) => Promise<VaultSwitchResult>; onadd: () => Promise<VaultSwitchResult>; onmanage: () => Promise<VaultSwitchResult>;
		busy: boolean; mobile: boolean; destroyed: (locked: boolean, owner: string) => void;
	} = $props();
	let locked = $state(false), disposed = false, dirty = false;
	const controller = new SourceController((_mapping, edited) => { if (edited) { dirty = true; editorDirty.set(true); } });
	controller.load(untrack(() => initial)); editorDirty.set(false);
	export function edit(text: string) { controller.replace(text, controller.state.doc.length); controller.focus(); }
	export function snapshot() { return { text: controller.state.doc.toString(), dirty, locked, readonly: controller.state.readOnly }; }
	export async function acquire() {
		if (disposed || locked || !(await save(controller.state.doc.toString()))) return null;
		dirty = false; editorDirty.set(false); locked = true; controller.configure(true, false);
		let released = false;
		return () => { if (disposed || released) return; released = true; locked = false; controller.configure(false, false); };
	}
	onDestroy(() => { disposed = true; destroyed(locked, owner); });
</script>

<div class="frame" inert={busy}>
	{#if mobile}
		<header><VaultSwitcher vaults={$appConfig?.vaults ?? []} active={activeVaultIdentity($appConfig)} {busy} {onselect} {onadd} {onmanage} /></header>
	{:else}
		<TitleBar onSwitchVault={onselect} onAddVault={onadd} onManageVaults={onmanage} switching={busy} />
	{/if}
	<section><SourceEditor {controller} readonly={locked} {mobile} /></section>
</div>
<style>
	.frame { height: 100vh; display: flex; flex-direction: column; }
	header { height: 44px; padding: 0 12px; display: flex; align-items: center; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); }
	section { padding: 24px; flex: 1; min-height: 0; }
</style>
