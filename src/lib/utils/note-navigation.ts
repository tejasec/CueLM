let currentNoteNavigation = 0;
let suspended = 0;

/** Native external edits freeze publication of pending navigation, not just input. */
export function suspendNoteNavigation(): () => void {
	suspended++;
	let released = false;
	return () => { if (!released) { released = true; suspended--; } };
}

/** Start an intent before any await, including selections of the already-open note. */
export function beginNoteNavigation(): number {
	return ++currentNoteNavigation;
}

export function isCurrentNoteNavigation(token: number): boolean {
	return token === currentNoteNavigation && suspended === 0;
}

/** A disposed owner may invalidate its own intent, but never a newer owner's intent. */
export function cancelNoteNavigation(token: number): void {
	if (token === currentNoteNavigation) currentNoteNavigation++;
}
