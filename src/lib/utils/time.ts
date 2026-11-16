const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
});
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long' });
const monthYearFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const localizedDates = new Map<string, {
	short: Intl.DateTimeFormat; full: Intl.DateTimeFormat; month: Intl.DateTimeFormat;
	monthYear: Intl.DateTimeFormat; relative: Intl.RelativeTimeFormat;
}>();
function displayDates(locale: string) {
	let value = localizedDates.get(locale);
	if (!value) {
		value = {
			short: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
			full: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
			month: new Intl.DateTimeFormat(locale, { month: 'long' }),
			monthYear: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
			relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }),
		};
		localizedDates.set(locale, value);
	}
	return value;
}

export function formatLocalDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

export function formatClockTime(date: Date, timeFormat?: string): string {
	const hours = date.getHours();
	const minutes = String(date.getMinutes()).padStart(2, '0');
	if (timeFormat === '12h') {
		return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
	}
	// Relative labels are for display, not text permanently inserted into a note.
	return `${String(hours).padStart(2, '0')}:${minutes}`;
}

export function formatRelativeTime(dateStr: string, locale?: string): string {
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return date.toString();
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (locale) {
		const relative = displayDates(locale).relative;
		if (seconds < 60) return relative.format(0, 'second');
		if (minutes < 60) return relative.format(-minutes, 'minute');
		if (hours < 24) return relative.format(-hours, 'hour');
		if (days < 7) return relative.format(-days, 'day');
		return displayDates(locale).short.format(date);
	}
	if (seconds < 60) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;

	return shortDateFormatter.format(date);
}

export function formatDate(dateStr: string, locale?: string): string {
	const date = new Date(dateStr);
	const formatter = locale ? displayDates(locale).full : fullDateFormatter;
	return Number.isNaN(date.getTime()) ? date.toString() : formatter.format(date);
}

// Relative-date bucket label for grouping the notes list:
// Today / Yesterday / Previous 7 Days / Previous 30 Days / "June" (this year) / "June 2025".
// Buckets are contiguous, so a list already sorted by date groups by consecutive label.
export function dateBucketLabel(dateStr: string, now: Date = new Date(), locale?: string): string {
	const d = new Date(dateStr);
	if (Number.isNaN(d.getTime())) return d.toString();
	const dayMs = 86400000;
	const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const today = startOfDay(now);
	const day = startOfDay(d);
	if (day >= today) return 'Today';
	if (day >= today - dayMs) return 'Yesterday';
	if (day >= today - 7 * dayMs) return 'Previous 7 Days';
	if (day >= today - 30 * dayMs) return 'Previous 30 Days';
	if (d.getFullYear() === now.getFullYear()) return (locale ? displayDates(locale).month : monthFormatter).format(d);
	return (locale ? displayDates(locale).monthYear : monthYearFormatter).format(d);
}
