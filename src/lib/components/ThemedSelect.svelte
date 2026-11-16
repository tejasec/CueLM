<script lang="ts">
	import { tick } from 'svelte';
	import { findTypeaheadIndex, moveSelectIndex, typeaheadQuery, TYPEAHEAD_TIMEOUT, type SelectOption } from '$lib/utils/select-navigation';

	let { id, label, options, value, disabled = false, compact = false, onchange }: {
		id: string;
		label: string;
		options: readonly SelectOption[];
		value: string;
		disabled?: boolean;
		/** Icon-only editor-mode trigger, using the same accessible listbox. */
		compact?: boolean;
		onchange: (value: string) => void | Promise<void>;
	} = $props();

	let root: HTMLDivElement;
	let trigger: HTMLButtonElement;
	let menu = $state<HTMLDivElement>();
	let open = $state(false);
	let active = $state(0);
	let query = '';
	let lastTyped = 0;
	let position = $state('visibility: hidden;');
	const selected = $derived(options.find(option => option.value === value));
	const listId = $derived(`${id}-listbox`);
	const optionId = (index: number) => `${id}-option-${index}`;

	function show(index = options.findIndex(option => option.value === value)) {
		if (disabled || !options.length) return;
		active = Math.max(0, Math.min(options.length - 1, index));
		query = '';
		position = 'visibility: hidden;';
		open = true;
	}

	function dismiss() {
		open = false;
		query = '';
	}

	async function choose(index: number) {
		const option = options[index];
		if (disabled || !option) return;
		const restoreFocus = document.activeElement === trigger;
		dismiss();
		try {
			if (option.value !== value) await onchange(option.value);
		} finally {
			await tick();
			// A pending save may temporarily disable the button. Do not steal focus if
			// the user has already moved to another control while the request ran.
			if (restoreFocus && document.activeElement === document.body && !disabled) {
				trigger.focus({ preventScroll: true });
			}
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled || event.isComposing || event.ctrlKey || event.metaKey) return;
		if (event.key === 'Escape') {
			if (open) { event.preventDefault(); event.stopPropagation(); dismiss(); }
			return;
		}
		if (event.key === 'Tab') { dismiss(); return; }
		if (event.altKey) {
			if (event.key === 'ArrowDown') { event.preventDefault(); show(); }
			else if (event.key === 'ArrowUp' && open) {
				event.preventDefault(); event.stopPropagation(); void choose(active);
			}
			return;
		}
		const next = moveSelectIndex(active, options.length, event.key);
		if (next !== null) {
			event.preventDefault(); event.stopPropagation();
			if (!open) show(event.key === 'Home' || event.key === 'End' ? next : undefined);
			else active = next;
			return;
		}
		const now = performance.now();
		const spaceInQuery = event.key === ' ' && open && query && now - lastTyped < TYPEAHEAD_TIMEOUT;
		if (event.key === 'Enter' || (event.key === ' ' && !spaceInQuery)) {
			event.preventDefault(); event.stopPropagation();
			if (open) void choose(active); else show();
			return;
		}
		if (event.key.length === 1) {
			event.preventDefault(); event.stopPropagation();
			if (!open) show();
			query = typeaheadQuery(query, event.key, now - lastTyped);
			lastTyped = now;
			const match = findTypeaheadIndex(options, query, active);
			if (match >= 0) active = match;
		}
	}

	function placeMenu() {
		if (!menu || !trigger) return;
		const rect = trigger.getBoundingClientRect();
		const viewport = window.visualViewport;
		const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
		const topEdge = (viewport?.offsetTop ?? 0) + 8;
		const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
		const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
		const width = Math.min(compact ? 240 : rect.width, rightEdge - leftEdge);
		const below = bottomEdge - rect.bottom - 4;
		const above = rect.top - topEdge - 4;
		const upward = below < Math.min(240, menu.scrollHeight) && above > below;
		const height = Math.max(36, Math.min(320, upward ? above : below));
		const top = upward ? rect.top - 4 - Math.min(menu.scrollHeight + 2, height) : rect.bottom + 4;
		const left = Math.max(leftEdge, Math.min(rect.left, rightEdge - width));
		position = `left: ${left}px; top: ${top}px; width: ${width}px; max-height: ${height}px;`;
	}

	// A portal avoids clipping by the scrollable Settings panel. The popup remains
	// app-rendered DOM, so its colors never come from the OS/native select menu.
	function portal(node: HTMLDivElement) {
		document.body.appendChild(node);
		menu = node;
		return { destroy() { node.remove(); menu = undefined; } };
	}

	$effect(() => { if (disabled || !options.length) dismiss(); });

	$effect(() => {
		if (!open || !menu) return;
		placeMenu();
		const outside = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (target && !root.contains(target) && !menu?.contains(target)) dismiss();
		};
		const blur = () => dismiss();
		const scroll = (event: Event) => {
			// Only scrolling an ancestor can move the trigger. Unrelated CodeMirror
			// scroll restoration must not close a menu that the user just opened.
			const target = event.target;
			if (target instanceof Node && target.contains(trigger) && !menu?.contains(target)) dismiss();
		};
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('scroll', scroll, true);
		window.addEventListener('resize', placeMenu);
		window.addEventListener('blur', blur);
		window.visualViewport?.addEventListener('resize', placeMenu);
		window.visualViewport?.addEventListener('scroll', placeMenu);
		const observer = new ResizeObserver(placeMenu);
		observer.observe(trigger);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('scroll', scroll, true);
			window.removeEventListener('resize', placeMenu);
			window.removeEventListener('blur', blur);
			window.visualViewport?.removeEventListener('resize', placeMenu);
			window.visualViewport?.removeEventListener('scroll', placeMenu);
			observer.disconnect();
		};
	});

	$effect(() => {
		if (!open || !menu) return;
		const index = Math.min(active, options.length - 1);
		void tick().then(() => {
			menu?.querySelector(`#${CSS.escape(optionId(index))}`)?.scrollIntoView({ block: 'nearest' });
		});
	});
</script>

<div class="themed-select" class:compact bind:this={root} onfocusout={(event) => {
	if (!root.contains(event.relatedTarget as Node | null)) dismiss();
}}>
	<button {id} type="button" class="select-trigger" class:open class:chosen={compact && value !== 'rich'} {disabled} bind:this={trigger}
		role="combobox" aria-label={compact ? `${label}: ${selected?.label ?? value}` : label} title={compact ? `${label}: ${selected?.label ?? value}` : undefined} aria-haspopup="listbox" aria-expanded={open}
		aria-controls={open ? listId : undefined} aria-activedescendant={open ? optionId(active) : undefined}
		onclick={() => { if (open) dismiss(); else show(); }} onkeydown={handleKeydown}>
		{#if compact}
			<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m5.5 4-4 4 4 4 1-1-3-3 3-3Zm5 0-1 1 3 3-3 3 1 1 4-4Z"/></svg>
		{:else}<span lang={selected?.lang}>{selected?.label ?? value}</span>{/if}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
	</button>
	{#if open}
		<div id={listId} class="select-menu" role="listbox" aria-label={label} tabindex="-1" style={position} use:portal>
			{#each options as option, index (option.value)}
				<button id={optionId(index)} type="button" class="select-option" class:active={active === index}
					role="option" aria-selected={option.value === value} tabindex="-1" lang={option.lang}
					onpointerdown={(event) => event.preventDefault()}
					onpointermove={() => { active = index; }} onclick={() => choose(index)}>
					<span>{option.label}</span>
					{#if option.value === value}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.themed-select { width: 100%; max-width: 320px; margin-top: 10px; }
	.themed-select.compact { width: auto; max-width: none; margin: 0; flex-shrink: 0; }
	.compact .select-trigger { min-height: 30px; width: 38px; padding: 5px 4px; gap: 2px; border-color: transparent; background: transparent; color: var(--text-secondary); }
	.compact .select-trigger.chosen { color: var(--accent); }
	.compact .select-trigger svg:last-child { width: 10px; }
	.compact .select-trigger:hover, .compact .select-trigger.open { color: var(--text-primary); background: var(--bg-hover); }
	.select-trigger {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		width: 100%; min-height: 40px; padding: 8px 12px;
		border: 1px solid var(--border-color); border-radius: 8px;
		background: var(--bg-secondary); color: var(--text-primary);
		font: inherit; font-size: 13px; text-align: start; cursor: pointer;
	}
	.select-trigger span { min-width: 0; overflow-wrap: anywhere; }
	.select-trigger svg { flex-shrink: 0; }
	.select-trigger:hover:not(:disabled) { background: var(--bg-hover); }
	.select-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.select-trigger.open { border-color: var(--accent); }
	.select-trigger.open svg:last-child { transform: rotate(180deg); }
	.select-trigger:disabled { opacity: 0.6; cursor: wait; }
	.select-menu {
		position: fixed; z-index: 2100; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain;
		padding: 4px; border: 1px solid var(--border-color); border-radius: 8px;
		background: var(--bg-secondary); color: var(--text-primary); box-shadow: var(--shadow-lg);
		scrollbar-color: var(--border-color) var(--bg-secondary);
	}
	.select-option {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		width: 100%; min-height: 36px; padding: 8px 10px; border: 0; border-radius: 4px;
		background: var(--bg-secondary); color: var(--text-primary);
		font: inherit; font-size: 13px; text-align: start; cursor: pointer;
	}
	.select-option span { min-width: 0; overflow-wrap: anywhere; }
	.select-option svg { flex-shrink: 0; color: var(--accent); }
	.select-option.active { background: var(--accent-light); color: var(--text-primary); }
	@media (pointer: coarse) { .compact .select-trigger { min-height: 40px; width: 44px; } }
</style>
