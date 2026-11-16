import type { AppConfig, VaultConfig, VaultIdentity } from '../types.ts';

export type VaultTarget = VaultIdentity & { existing: boolean };
export type VaultSwitchResult = 'done' | 'cancelled' | 'blocked' | 'stale' | 'busy';
export type VaultRelease = () => void;

export function vaultIdentity(vault: VaultConfig): VaultIdentity {
	return { path: vault.path, bookmarkId: vault.bookmark_id ?? null };
}
export function activeVaultIdentity(config: Pick<AppConfig, 'active_vault' | 'active_bookmark_id'> | null): VaultIdentity | null {
	return config?.active_vault ? { path: config.active_vault, bookmarkId: config.active_bookmark_id ?? null } : null;
}
export function vaultIdentityKey(vault: VaultIdentity | null): string {
	return JSON.stringify(vault ? [vault.path, vault.bookmarkId] : null);
}
export function sameVault(a: VaultIdentity | null, b: VaultIdentity | null): boolean {
	if (!a || !b) return a === b;
	return a.bookmarkId || b.bookmarkId ? !!a.bookmarkId && a.bookmarkId === b.bookmarkId : a.path === b.path;
}
export function vaultEventMatches(event: { vault_path: string; bookmark_id?: string | null }, active: VaultIdentity | null): boolean {
	const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
	return !!active && typeof event.vault_path === 'string' && normalize(event.vault_path) === normalize(active.path) && (event.bookmark_id ?? null) === active.bookmarkId;
}
export function vaultDisplayName(vault: Pick<VaultConfig, 'name' | 'path'>): string {
	return vault.name.trim() || vault.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) || vault.path;
}

/** Preserve live device preferences when publishing the native activation snapshot. */
export function mergeVaultActivation(current: AppConfig | null, activated: AppConfig): AppConfig {
	if (!current) return activated;
	return { ...current, active_vault: activated.active_vault, active_bookmark_id: activated.active_bookmark_id,
		vaults: activated.vaults.map(vault => {
			const previous = current.vaults.find(item => sameVault(vaultIdentity(item), vaultIdentity(vault)));
			const latest = (a: string | null | undefined, b: string | null | undefined) =>
				a && (!b || Date.parse(a) > Date.parse(b)) ? a : b;
			return previous ? { ...vault,
				last_sync_time: latest(previous.last_sync_time, vault.last_sync_time),
				last_backup_time: latest(previous.last_backup_time, vault.last_backup_time) } : vault;
		}) };
}

export interface VaultSwitchHooks {
	current: () => VaultIdentity | null;
	/** Save and freeze editing until the returned release function is called. */
	acquire: () => Promise<VaultRelease | null>;
	open: (target: VaultTarget, expected: VaultIdentity) => Promise<AppConfig>;
	commit: (config: AppConfig) => Promise<void>;
	manage: () => Promise<void>;
	busy: (value: boolean) => void;
}

/** One transition at a time. Never clear the old document before native activation succeeds. */
export function createVaultSwitch(hooks: VaultSwitchHooks) {
	let busy = false;
	async function run(choose: (() => Promise<VaultTarget | null>) | null): Promise<VaultSwitchResult> {
		if (busy) return 'busy';
		const origin = hooks.current();
		if (!origin) return 'stale';
		const originKey = vaultIdentityKey(origin);
		let release: VaultRelease | null = null;
		busy = true;
		hooks.busy(true);
		try {
			const target = choose ? await choose() : null;
			if (choose && !target) return 'cancelled';
			if (vaultIdentityKey(hooks.current()) !== originKey) return 'stale';
			if (target && sameVault(origin, target)) return 'done';
			release = await hooks.acquire();
			if (!release) return 'blocked';
			if (vaultIdentityKey(hooks.current()) !== originKey) return 'stale';
			if (target) {
				const config = await hooks.open(target, origin);
				if (!sameVault(activeVaultIdentity(config), target) || !Array.isArray(config.vaults)) {
					throw new Error('The vault activation response was invalid.');
				}
				await hooks.commit(config);
			} else await hooks.manage();
			return 'done';
		} finally {
			try { release?.(); } finally { busy = false; hooks.busy(false); }
		}
	}
	return {
		switchTo: (vault: VaultConfig) => run(async () => ({ ...vaultIdentity(vault), existing: true })),
		add: (choose: () => Promise<VaultTarget | null>) => run(choose),
		manage: () => run(null),
	};
}
