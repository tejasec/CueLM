<script lang="ts">
	import { onDestroy, untrack, tick } from 'svelte';
	import { confirm } from '@tauri-apps/plugin-dialog';
	import { t } from '$lib/i18n';
	import { appConfig } from '$lib/stores/app';
	import { isMobile } from '$lib/platform';
	import { copyTextToClipboard } from '$lib/api';
	import { getMcpStatus, setMcpAccess, getMcpClientConfig, type McpAccess, type McpStatus } from '$lib/mcp';
	import ThemedSelect from './ThemedSelect.svelte';
	import { activeVaultIdentity, vaultIdentity, vaultIdentityKey } from '$lib/utils/vault-switch';
	const group = $props.id();
	let selectedVault = $state('');
	const entries = $derived($appConfig?.vaults ?? []);
	const activeKey = $derived(vaultIdentityKey(activeVaultIdentity($appConfig)));
	const vaultKey = $derived(selectedVault || activeKey);
	const entry = $derived(entries.find(entry => vaultIdentityKey(vaultIdentity(entry)) === vaultKey));
	const vault = $derived(entry ? vaultIdentity(entry) : null);
	const name = $derived(entry?.name || vault?.path || '');
	const vaultOptions = $derived(entries.map(entry => ({ value: vaultIdentityKey(vaultIdentity(entry)), label: `${entry.name} — ${entry.path}` })));
	let status = $state<McpStatus | null>(null), loading = $state(true), pending = $state(false);
	let permission = $state<HTMLFieldSetElement>();
	let error = $state(''), copied = $state(false), configuration = $state('');
	let generation = 0, disposed = false;
	const enabled = $derived(status?.mode === 'read' || status?.mode === 'write');
	$effect(() => {
		void vaultKey;
		const owner = untrack(() => vault);
		const request = ++generation;
		status = null; pending = false; error = ''; configuration = ''; copied = false; loading = !isMobile && !!owner;
		if (!owner || isMobile) return;
		void getMcpStatus(owner).then(value => { if (request === generation && !disposed) { status = value; error = value.error ?? ''; } })
			.catch(cause => { if (request === generation && !disposed) error = String(cause); })
			.finally(() => { if (request === generation && !disposed) loading = false; });
	});
	onDestroy(() => { disposed = true; generation++; });
	async function choose(mode: McpAccess) {
		const owner = vault, request = generation;
		for (const input of permission?.querySelectorAll<HTMLInputElement>('input') ?? []) input.checked = input.value === (status?.mode === 'write' ? 'write' : 'read');
		if (!owner || loading || pending || mode === status?.mode) return;
		const focused = document.activeElement as HTMLElement | null;
		pending = true; error = ''; copied = false;
		try {
			if (mode === 'write' && !(await confirm($t('mcp.confirmWrite', { vault: name }), { title: $t('mcp.title'), kind: 'warning', okLabel: $t('mcp.allowEditing'), cancelLabel: $t('ui.cancel') }))) return;
			if (request !== generation || disposed) return;
			const value = await setMcpAccess(owner, mode);
			if (request === generation && !disposed) { status = value; configuration = ''; }
		} catch (cause) { if (request === generation && !disposed) error = String(cause); }
		finally {
			if (request === generation && !disposed) {
				pending = false; await tick();
				if (document.activeElement === document.body && focused?.isConnected) {
					if (focused.matches('input[type="radio"]')) permission?.querySelector<HTMLInputElement>('input:checked')?.focus();
					else focused.focus();
				}
			}
		}
	}
	async function copy() {
		const owner = vault, request = generation;
		if (!owner || pending || !status?.ready) return;
		pending = true; error = ''; copied = false;
		try {
			const value = JSON.stringify(await getMcpClientConfig(owner), null, 2);
			if (request !== generation || disposed) return;
			await copyTextToClipboard(value);
			if (request === generation && !disposed) { configuration = value; copied = true; }
		} catch (cause) { if (request === generation && !disposed) error = String(cause); }
		finally { if (request === generation && !disposed) pending = false; }
	}
</script>

<section class="mcp-settings" aria-busy={loading || pending}>
	<h3>{$t('mcp.title')}</h3>
	<p class="intro">{$t('mcp.description')}</p>
	{#if isMobile}
		<p>{$t('mcp.desktopOnly')}</p>
	{:else}
		<div class="scope">
			<span>{$t('mcp.vault')}</span>
			{#if entries.length > 1}
				<ThemedSelect id={`${group}-vault`} label={$t('mcp.chooseVault')} options={vaultOptions} value={vaultKey} disabled={pending} onchange={value => { selectedVault = value; }} />
			{:else}<strong>{name}</strong>{/if}
			<code>{vault?.path ?? ''}</code>
		</div>
		<div class="enable-row">
			<label for={`${group}-enable`}>{$t('mcp.enable')}</label>
			<button id={`${group}-enable`} class="mcp-switch" class:on={enabled} type="button" role="switch" aria-label={$t('mcp.enable')} aria-checked={enabled} disabled={loading || pending || !vault} onclick={() => choose(enabled ? 'off' : 'read')}><span></span></button>
		</div>
		<div class="permission">
			<span class="permission-label">{$t('mcp.permission')}</span>
			<fieldset bind:this={permission} aria-label={$t('mcp.permission')} disabled={!enabled || pending || loading}>
				<label><input type="radio" name={group} value="read" checked={status?.mode !== 'write'} onchange={() => choose('read')} /><span>{$t('mcp.readOnly')}</span></label>
				<label><input type="radio" name={group} value="write" checked={status?.mode === 'write'} onchange={() => choose('write')} /><span>{$t('mcp.allowEditing')}</span></label>
			</fieldset>
			<p>{status?.mode === 'write' ? $t('mcp.editHelp') : $t('mcp.readHelp')}</p>
		</div>
		<div class="connect">
			<button class="copy" type="button" disabled={!status?.ready || pending || loading} onclick={copy}>{$t('mcp.copyConfig')}</button>
			{#if loading}<p role="status">{$t('mcp.loading')}</p>{/if}
			{#if copied}<p role="status">{$t('mcp.copied')}</p>{/if}
			{#if configuration}<details><summary>{$t('mcp.showConfig')}</summary><pre>{configuration}</pre></details>{/if}
		</div>
		<ol><li>{$t('mcp.stepEnable')}</li><li>{$t('mcp.stepCopy')}</li><li>{$t('mcp.stepRunning')}</li></ol>
		<p class="privacy">{$t('mcp.privacy')}</p>
		{#if error}<p class="error" role="alert">{$t('mcp.failed', { error })}</p>{/if}
	{/if}
</section>

<style>
	.mcp-settings { width: 100%; min-width: 0; color: var(--text-primary); }
	h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
	p, li { font-size: 12px; line-height: 1.55; color: var(--text-secondary); }
	p { margin: 6px 0; }
	.intro { margin-bottom: 18px; }
	.scope { display: flex; flex-direction: column; gap: 4px; padding-block: 12px; border-block: 1px solid var(--border-color); font-size: 12px; }
	.scope > span { color: var(--text-secondary); }
	.scope code { font-family: var(--font-mono, monospace); color: var(--text-secondary); overflow-wrap: anywhere; font-size: 11px; }
	.enable-row { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding-block: 18px; font-size: 13px; }
	.enable-row > label { min-width: 0; }
	.mcp-switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; border: 0; border-radius: 11px; background: var(--border-color); cursor: pointer; }
	.mcp-switch > span { position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: white; }
	.mcp-switch.on { background: var(--accent); }
	.mcp-switch.on > span { left: 19px; }
	.permission-label { font-size: 12px; font-weight: 500; }
	fieldset { display: flex; max-width: 360px; margin: 8px 0; padding: 0; min-width: 0; border: 1px solid var(--border-color); border-radius: 7px; overflow: hidden; }
	fieldset > label { position: relative; flex: 1; display: flex; min-width: 0; }
	fieldset > label + label { border-inline-start: 1px solid var(--border-color); }
	input { position: absolute; width: 1px; height: 1px; opacity: 0; }
	fieldset span { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 38px; box-sizing: border-box; padding: 8px 10px; color: var(--text-secondary); background: var(--bg-secondary); font-size: 12px; line-height: 1.4; text-align: center; cursor: pointer; }
	input:checked + span { background: var(--accent-light, var(--bg-hover)); color: var(--accent); font-weight: 600; }
	input:focus-visible + span, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	button:disabled, fieldset:disabled span { opacity: .55; cursor: default; }
	.connect { margin-block: 20px; }
	.copy { border: 1px solid var(--border-color); border-radius: 7px; padding: 9px 12px; background: var(--bg-secondary); color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer; max-width: 100%; white-space: normal; }
	summary { font-size: 12px; margin-top: 12px; cursor: pointer; }
	pre { margin-block: 10px 0; padding: 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 7px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
	ol { padding-inline-start: 20px; margin-block: 12px; }
	li + li { margin-top: 8px; }
	.privacy { padding-top: 12px; border-top: 1px solid var(--border-color); }
	.error { color: var(--text-primary); overflow-wrap: anywhere; }
	@media (pointer: coarse) { fieldset span, .copy { min-height: 44px; } }
</style>
