import { IntlMessageFormat } from 'intl-messageformat';
import english from './locales/en.json' with { type: 'json' };
import russian from './locales/ru.json' with { type: 'json' };
import dutch from './locales/nl.json' with { type: 'json' };
import german from './locales/de.json' with { type: 'json' };
import spanish from './locales/es.json' with { type: 'json' };
import french from './locales/fr.json' with { type: 'json' };
import italian from './locales/it.json' with { type: 'json' };
import portuguese from './locales/pt-PT.json' with { type: 'json' };
import brazilian from './locales/pt-BR.json' with { type: 'json' };
import registry from './languages.json' with { type: 'json' };

export type Locale = 'en' | 'ru' | 'nl' | 'de' | 'es' | 'fr' | 'it' | 'pt-PT' | 'pt-BR';
export type Language = Locale | 'system';
export type MessageKey = keyof typeof english;
export type MessageValues = Record<string, unknown>;
export const catalogs: Record<Locale, Record<string, string>> = {
	en: english, ru: russian, nl: dutch, de: german, es: spanish, fr: french, it: italian,
	'pt-PT': portuguese, 'pt-BR': brazilian,
};
export const languageOptions = registry as readonly { code: Locale; name: string }[];
const cache = new Map<string, IntlMessageFormat>();

function canonicalTag(value: string): string {
	return value.trim().split(/[.@]/)[0].replace(/_/g, '-').toLowerCase();
}

export function normalizeLanguage(value: unknown): Language {
	if (typeof value !== 'string') return 'system';
	const tag = canonicalTag(value);
	return languageOptions.find(option => option.code.toLowerCase() === tag)?.code ?? 'system';
}

export function resolveLocale(language: unknown, systemLanguages: readonly string[] = []): Locale {
	const preference = normalizeLanguage(language);
	if (preference !== 'system') return preference;
	for (const value of systemLanguages) {
		const tag = canonicalTag(value);
		const exact = normalizeLanguage(tag);
		if (exact !== 'system') return exact;
		const [base, ...subtags] = tag.split('-');
		// Unqualified Portuguese and non-Brazilian regional variants use Portugal.
		if (base === 'pt') return subtags.includes('br') ? 'pt-BR' : 'pt-PT';
		const matched = languageOptions.find(option => option.code === base);
		if (matched) return matched.code;
	}
	return 'en';
}

/** ICU interpolation is plain text, never HTML. Missing/invalid translations fall back to English. */
export function formatMessage(locale: Locale, key: string, values: MessageValues = {}): string {
	const normalized = Object.fromEntries(Object.entries(values).map(([name, value]) => [
		name, typeof value === 'string' || typeof value === 'number' || value instanceof Date ? value : value == null ? '' : String(value),
	]));
	for (const candidate of locale === 'en' ? ['en'] as const : [locale, 'en'] as const) {
		const message = catalogs[candidate][key];
		if (message === undefined) continue;
		try {
			const cacheKey = `${candidate}:${key}`;
			let formatter = cache.get(cacheKey);
			if (!formatter) {
				formatter = new IntlMessageFormat(message, candidate, undefined, { ignoreTag: true });
				cache.set(cacheKey, formatter);
			}
			return String(formatter.format(normalized));
		} catch { /* A broken community translation must not break the interface. */ }
	}
	return key;
}

// Only use this for app-owned labels (commands/presets), never note titles or note content.
const sourceKeys = new Map(Object.entries(english).map(([key, text]) => [text.replace(/''/g, "'").toLowerCase(), key]));
export function labelKey(source: string): MessageKey | undefined {
	return sourceKeys.get(source.toLowerCase()) as MessageKey | undefined;
}
export function formatLabel(locale: Locale, source: string): string {
	const key = labelKey(source);
	return key ? formatMessage(locale, key) : source;
}
