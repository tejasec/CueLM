import { derived, get, writable } from 'svelte/store';
import { formatLabel, formatMessage, labelKey, normalizeLanguage, resolveLocale, type Language, type MessageKey, type MessageValues } from './core.ts';
export { normalizeLanguage, languageOptions, type Language, type Locale } from './core.ts';

export const language = writable<Language>('system');
const systemLanguages = writable<readonly string[]>(typeof navigator === 'undefined' ? [] : navigator.languages);
if (typeof window !== 'undefined') {
	window.addEventListener('languagechange', () => systemLanguages.set(navigator.languages));
}
export const locale = derived([language, systemLanguages], ([$language, $systemLanguages]) => resolveLocale($language, $systemLanguages));
export const t = derived(locale, $locale => (key: MessageKey, values?: MessageValues) => formatMessage($locale, key, values));
export const label = derived(locale, $locale => (source: string) => formatLabel($locale, source));
export const tr = (key: MessageKey, values?: MessageValues): string => formatMessage(get(locale), key, values);
export const translateLabel = (source: string): string => formatLabel(get(locale), source);
export function applyLanguage(value: unknown): void { language.set(normalizeLanguage(value)); }

// Node views create some app controls outside Svelte. Bind only explicitly marked UI text;
// never walk editor content or rebuild the editor when changing language.
const elementBindings = new WeakMap<Element, Map<string, { key: MessageKey; values: MessageValues }>>();
const boundElements = new Set<WeakRef<Element>>();
function renderBinding(element: Element, property: string, key: MessageKey, values: MessageValues) {
	const text = tr(key, values);
	if (property === 'textContent') element.textContent = text;
	else element.setAttribute(property, text);
}
export function setUiText(element: Element, key: MessageKey, values: MessageValues = {}, property = 'textContent'): void {
	let bindings = elementBindings.get(element);
	if (!bindings) {
		bindings = new Map();
		elementBindings.set(element, bindings);
		boundElements.add(new WeakRef(element));
	}
	bindings.set(property, { key, values });
	renderBinding(element, property, key, values);
}
export function setUiLabel(element: Element, source: string, property = 'textContent'): void {
	const key = labelKey(source);
	if (key) setUiText(element, key, {}, property);
	else if (property === 'textContent') element.textContent = source;
	else element.setAttribute(property, source);
}
locale.subscribe(() => {
	for (const ref of boundElements) {
		const element = ref.deref();
		if (!element) { boundElements.delete(ref); continue; }
		for (const [property, binding] of elementBindings.get(element) ?? []) {
			renderBinding(element, property, binding.key, binding.values);
		}
	}
});
