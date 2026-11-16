# Interface translations

English (`locales/en.json`) is the reference catalog. The app also bundles Russian, Dutch, German, Spanish, French, Italian, Portuguese (Portugal) and Portuguese (Brazil). All work offline. Settings → General → Language lists their native names from `languages.json`, alongside System default.

System language detection matches regional variants such as `nl-BE`, `de-AT`, `es-MX` and `fr-CA`. Portuguese keeps its regional distinction: `pt-BR` selects Brazil; bare `pt` and other Portuguese regions select Portugal. An explicit preference overrides the system language. Unsupported system languages fall back to English.

Community contributors can follow the [translation guide](../../../docs/translations/README.md) and attach a JSON file to a GitLab issue without changing application code.

The preference is saved in the device's application configuration, not the vault. A native `language-changed` event updates open note windows. Changing language does not reload the editor or change notes, filenames, tags, Markdown syntax, frontmatter keys, shortcut codes or saved option IDs.

## Add or change a message

Use a stable, descriptive key and add it to every catalog:

```json
{
  "notes.moveFailed": "Could not move “{title}”: {error}"
}
```

In a Svelte component:

```svelte
<script lang="ts">
  import { t as ui } from '$lib/i18n';
</script>

<button title={$ui('ui.save')}>{$ui('ui.save')}</button>
<p>{$ui('notes.moveFailed', { title, error })}</p>
```

The message key is checked by TypeScript against the English catalog. Use `tr(key, values)` for event-time messages outside markup. For controls created by editor node views, use `setUiText(element, key, values, property)` so existing controls update without rebuilding the editor. The default property is `textContent`; `title`, `placeholder` and `aria-label` are also supported.

Command and preset data keep their canonical English labels and stable IDs. Translate those labels at their display sites with `$uiLabel(label)` (`label as uiLabel` from this module). A change to an English command/preset label must also update its canonical label in the source. Never apply this lookup to note titles, tags, custom theme names or other user-authored text.

## ICU messages

Messages use `intl-messageformat`, not string replacement. Translate complete sentences, keep argument names unchanged, and use plural branches rather than appending an English `s`:

```json
{
  "count.notes": "{count, plural, one {# note} other {# notes}}"
}
```

Russian needs `one`, `few`, `many` and `other`:

```json
{
  "count.notes": "{count, plural, one {# заметка} few {# заметки} many {# заметок} other {# заметки}}"
}
```

Every plural needs an `other` branch. Escape a literal apostrophe as `''` when needed by ICU syntax. Arguments are plain text: do not use `{@html}` to display translated messages containing user input. Keep markup in the component, not the catalog.

Missing or malformed messages in any language fall back to English. The automated tests reject missing keys, mismatched arguments and invalid ICU syntax before release. Keep European and Brazilian Portuguese vocabulary separate; do not merge their catalogs or saved preference IDs.

## Add a language

1. Copy `en.json` to a new locale file and translate its values without renaming keys.
2. Register its import, catalog and `Locale` type in `core.ts`. Add its code and autonym to `languages.json`. Settings reads this registry; API and configuration types reuse `Language`.
3. Add its bundled catalog to `src-tauri/src/i18n.rs`. Native preference validation reads `languages.json`. Extend both frontend and native regional matching if the new locale needs special handling.
4. Test plural forms, long labels, dates, keyboard navigation, native tray labels, preference persistence and detached windows. Test right-to-left layout before advertising an RTL language.

The catalogs are initial translations. Native-speaker review is welcome, especially for terminology and longer help messages. Technical names such as font families, theme presets, providers and file formats can retain their original spelling.

Locale-sensitive display dates and calendar headings use `Intl`. Stored dates and text deliberately inserted into notes keep their existing format settings. Detailed operating-system and server error messages can remain in the language provided by their source; app-owned labels and message prefixes belong in the catalogs.

## Validation

Run `pnpm check`, `pnpm test`, `pnpm test:rust`, `pnpm lint:rust` and `pnpm build`. `tests/i18n.test.mjs` validates every catalog, ICU argument parity, plural forms, Portuguese regional vocabulary, apostrophe escaping, fallback, interpolation, live changes, explicit node-view bindings and date formatting. It also checks that the frontend registry and native bundled catalogs agree. Also check the installed app on each platform before release.
