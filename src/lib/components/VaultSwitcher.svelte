<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { t } from '$lib/i18n';
	import type { VaultConfig, VaultIdentity } from '$lib/types';
	import { sameVault, vaultIdentity, vaultIdentityKey, vaultDisplayName, type VaultSwitchResult } from '$lib/utils/vault-switch';
	import { findTypeaheadIndex, typeaheadQuery, TYPEAHEAD_TIMEOUT } from '$lib/utils/select-navigation';

	let { vaults, active, busy = false, onselect, onadd, onmanage }: {
		vaults: readonly VaultConfig[];
		active: VaultIdentity | null;
		busy?: boolean;
		onselect: (vault: VaultConfig) => Promise<VaultSwitchResult>;
		onadd: () => Promise<VaultSwitchResult>;
		onmanage: () => Promise<VaultSwitchResult>;
	} = $props();
	const componentId = $props.id();
	const menuId = `${componentId}-vault-menu`;
	const current = $derived(vaults.find(vault => sameVault(vaultIdentity(vault), active)));
	const name = $derived(current ? vaultDisplayName(current) : active?.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) || $t('ui.vault'));
	let root: HTMLDivElement;
	let trigger: HTMLButtonElement;
	let menu = $state<HTMLDivElement>();
	let open = $state(false);
	let pending = $state(false);
	let error = $state<{ key: 'vaultSwitcher.failed' | 'vaultSwitcher.blocked' | 'vaultSwitcher.stale'; detail?: string } | null>(null);
	let position = $state('visibility: hidden;');
	let disposed = false;
	let query = '', lastTyped = 0;
	onDestroy(() => { disposed = true; });
	const buttons = () => Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);

	async function show(index = vaults.findIndex(vault => sameVault(vaultIdentity(vault), active))) {
		if (pending || busy) return;
		open = true; error = null; query = ''; position = 'visibility: hidden;';
		await tick();
		if (disposed || !open) return;
		const items = buttons(); items[Math.max(0, Math.min(items.length - 1, index))]?.focus({ preventScroll: true });
	}
	function dismiss(restoreFocus = false) {
		if (pending || busy) return;
		open = false; query = '';
		if (restoreFocus) trigger?.focus({ preventScroll: true });
	}
	async function run(action: () => Promise<VaultSwitchResult>) {
		if (pending || busy) return;
		pending = true; error = null;
		let result: VaultSwitchResult | undefined;
		try {
			result = await action();
			if (disposed) return;
			if (result === 'blocked') error = { key: 'vaultSwitcher.blocked' };
			if (result === 'stale') error = { key: 'vaultSwitcher.stale' };
		} catch (cause) { if (!disposed) error = { key: 'vaultSwitcher.failed', detail: String(cause) }; }
		finally { if (!disposed) pending = false; }
		await tick();
		if (disposed) return;
		if (result === 'done' || result === 'cancelled') dismiss(true);
		else buttons()[0]?.focus({ preventScroll: true });
	}
	function onMenuKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault(); event.stopPropagation(); dismiss(true); return;
		}
		if (pending || busy || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
		const items = buttons();
		if (!items.length) return;
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			event.preventDefault(); event.stopPropagation();
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
				: event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
			items[next].focus(); return;
		}
		if (event.key.length === 1 && event.key !== ' ') {
			event.preventDefault(); event.stopPropagation();
			const now = performance.now(); query = typeaheadQuery(query, event.key, now - lastTyped); lastTyped = now;
			const options = items.map((item, i) => ({ value: String(i), label: item.dataset.name ?? item.textContent ?? '' }));
			const next = findTypeaheadIndex(options, query, Math.max(0, index));
			if (next >= 0) items[next].focus();
		}
	}
	function placeMenu() {
		if (!menu || !trigger) return;
		const rect = trigger.getBoundingClientRect(), viewport = window.visualViewport;
		const leftEdge = (viewport?.offsetLeft ?? 0) + 8, topEdge = (viewport?.offsetTop ?? 0) + 8;
		const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 16);
		const bottom = topEdge + (viewport?.height ?? window.innerHeight) - 16;
		const popupWidth = Math.min(360, width);
		const below = bottom - rect.bottom - 4, above = rect.top - topEdge - 4;
		const upward = below < Math.min(240, menu.scrollHeight) && above > below;
		const height = Math.max(36, Math.min(480, upward ? above : below));
		const top = upward ? rect.top - 4 - Math.min(menu.scrollHeight + 2, height) : rect.bottom + 4;
		position = `left: ${Math.max(leftEdge, Math.min(rect.left, leftEdge + width - popupWidth))}px; top: ${Math.max(topEdge, top)}px; width: ${popupWidth}px; max-height: ${height}px;`;
	}
	function portal(node: HTMLDivElement) {
		document.body.appendChild(node); menu = node;
		return { destroy() { node.remove(); menu = undefined; } };
	}
	$effect(() => {
		if (!open || !menu) return;
		placeMenu();
		const outside = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!root.contains(target) && !menu?.contains(target)) dismiss();
		};
		const scroll = (event: Event) => {
			const target = event.target;
			if (target instanceof Node && target.contains(trigger) && !menu?.contains(target)) dismiss();
		};
		const blur = () => dismiss();
		document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', scroll, true);
		window.addEventListener('resize', placeMenu); window.addEventListener('blur', blur);
		window.visualViewport?.addEventListener('resize', placeMenu); window.visualViewport?.addEventListener('scroll', placeMenu);
		const observer = new ResizeObserver(placeMenu); observer.observe(trigger); observer.observe(menu);
		return () => {
			document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true);
			window.removeEventListener('resize', placeMenu); window.removeEventListener('blur', blur);
			window.visualViewport?.removeEventListener('resize', placeMenu); window.visualViewport?.removeEventListener('scroll', placeMenu);
			observer.disconnect();
		};
	});
</script>

<div class="vault-switcher" bind:this={root}>
	<button type="button" class="vault-trigger" class:open disabled={busy || pending} bind:this={trigger}
		aria-label={`${$t('vaultSwitcher.label')}: ${name}`} title={active?.path ?? name} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
		onclick={() => open ? dismiss(true) : show()} onkeydown={event => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); void show(event.key === 'ArrowUp' ? vaults.length + 1 : undefined); }
			if (event.key === 'Escape') { event.stopPropagation(); dismiss(true); }
		}}>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="16" rx="2"/><circle cx="12" cy="11" r="3.5"/><path d="M7 19v2m10-2v2"/></svg>
		<span>{name}</span>
		<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
	</button>
	{#if open}
		<div class="vault-menu" id={menuId} role="menu" aria-label={$t('vaultSwitcher.label')} aria-busy={busy || pending} tabindex="-1" style={position} use:portal onkeydown={onMenuKeydown}>
			{#each vaults as vault (vaultIdentityKey(vaultIdentity(vault)))}
				<button type="button" class="vault-option" role="menuitemradio" aria-checked={sameVault(vaultIdentity(vault), active)} tabindex="-1" disabled={busy || pending}
					data-name={vaultDisplayName(vault)} title={vault.path} onclick={() => run(() => onselect(vault))}>
					<span class="vault-check" aria-hidden="true">{#if sameVault(vaultIdentity(vault), active)}✓{/if}</span>
					<span class="vault-description"><span class="vault-name">{vaultDisplayName(vault)}</span><span class="vault-path">{vault.path}</span></span>
				</button>
			{:else}<p class="vault-empty">{$t('vaultSwitcher.empty')}</p>{/each}
			<div class="vault-separator" role="separator"></div>
			<button type="button" class="vault-option vault-action" role="menuitem" tabindex="-1" disabled={busy || pending} onclick={() => run(onadd)}><span aria-hidden="true">＋</span><span>{$t('vaultSwitcher.add')}</span></button>
			<button type="button" class="vault-option vault-action" role="menuitem" tabindex="-1" disabled={busy || pending} onclick={() => run(onmanage)}><span aria-hidden="true">⋯</span><span>{$t('ui.manage_vaults')}</span></button>
			{#if busy || pending}<p class="vault-message" role="status">{$t('vaultSwitcher.switching')}</p>{/if}
			{#if error}<p class="vault-error" role="alert">{$t(error.key, { error: error.detail ?? '' })}</p>{/if}
		</div>
	{/if}
</div>

<style>
	.vault-switcher { min-width: 0; max-width: 100%; -webkit-app-region: no-drag; }
	.vault-trigger { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; min-height: 26px; padding: 3px 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer; -webkit-app-region: no-drag; }
	.vault-trigger span { min-width: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.vault-trigger svg { flex-shrink: 0; }
	.vault-trigger:hover, .vault-trigger.open { background: var(--bg-hover); border-color: var(--border-color); }
	.vault-trigger:disabled { cursor: wait; opacity: .6; }
	.vault-trigger:focus-visible, .vault-option:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	.vault-menu { position: fixed; z-index: 2200; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: 5px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); box-shadow: var(--shadow-lg, 0 8px 28px #0003); -webkit-app-region: no-drag; }
	.vault-option { display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; padding: 8px; border: 0; border-radius: 5px; background: transparent; color: inherit; text-align: start; font: inherit; font-size: 13px; cursor: pointer; }
	.vault-option:hover, .vault-option:focus { background: var(--bg-hover); }
	.vault-option:disabled { cursor: wait; opacity: .6; }
	.vault-check { flex: 0 0 16px; color: var(--accent); }
	.vault-description { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
	.vault-name { font-weight: 500; overflow-wrap: anywhere; }
	.vault-path { font-size: 11px; line-height: 1.4; color: var(--text-secondary); overflow-wrap: anywhere; }
	.vault-action > span:first-child { width: 16px; flex-shrink: 0; text-align: center; }
	.vault-separator { height: 1px; background: var(--border-color); margin: 5px 3px; }
	.vault-message, .vault-empty { margin: 8px; color: var(--text-secondary); font-size: 12px; }
	.vault-error { margin: 8px; color: var(--text-primary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
	@media (pointer: coarse) { .vault-trigger { min-height: 40px; } .vault-option { min-height: 44px; } }
</style>
