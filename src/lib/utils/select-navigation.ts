export interface SelectOption {
	value: string;
	label: string;
	lang?: string;
}

/** Navigation changes the active option, not the saved value. */
export function moveSelectIndex(index: number, count: number, key: string): number | null {
	if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return null;
	if (count <= 0) return -1;
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	if (index < 0) return key === 'ArrowUp' ? count - 1 : 0;
	return Math.max(0, Math.min(count - 1, index + (key === 'ArrowDown' ? 1 : -1)));
}

export const TYPEAHEAD_TIMEOUT = 700;

export function typeaheadQuery(previous: string, key: string, elapsed: number): string {
	const query = elapsed >= TYPEAHEAD_TIMEOUT ? key : previous + key;
	const letters = [...query.toLowerCase()];
	// Repeated letters cycle matches, e.g. P switches between the Portuguese variants.
	return letters.every(letter => letter === letters[0]) ? key : query;
}

function fold(text: string): string {
	return text.normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase();
}

export function findTypeaheadIndex(options: readonly SelectOption[], query: string, current: number): number {
	if (!query) return -1;
	const prefix = fold(query);
	for (let step = 1; step <= options.length; step++) {
		const index = (Math.max(-1, current) + step) % options.length;
		if (fold(options[index].label).startsWith(prefix)) return index;
	}
	return -1;
}
