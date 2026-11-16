# Translate HelixNotes

You can contribute a translation without building the app or writing code. Translate a JSON file and attach it to a [GitLab issue](https://gitlab.com/ArkHost/HelixNotes/-/issues/new).

## Files to use

- **Full template:** [`en.json`](../../src/lib/i18n/locales/en.json). Copy this file to start a translation. Use GitLab's **Open raw** or download button to save the JSON, not the surrounding web page.
- **Short example:** [`example.json`](example.json). This shows the format, but is not a complete language file.
- **Existing translation:** [`ru.json`](../../src/lib/i18n/locales/ru.json), including Russian plural forms.

The English file is the reference. Download the latest version before you start, and note the app version or Git commit you used. You can also improve an existing translation. See [`languages.json`](../../src/lib/i18n/languages.json) for the supported language codes and native names.

Portuguese has separate [`pt-PT.json`](../../src/lib/i18n/locales/pt-PT.json) and [`pt-BR.json`](../../src/lib/i18n/locales/pt-BR.json) catalogs. Keep regional wording such as *ficheiro/arquivo*, *guardar/salvar* and *palavra-passe/senha* appropriate to each variant.

## Translate the values

Name your copy after the language code, for example `de.json` for German or `pt-BR.json` for Brazilian Portuguese. Save it as UTF-8.

Keep the keys on the left unchanged. Translate the text on the right:

```json
{
  "ui.save": "Speichern",
  "ui.cancel": "Abbrechen",
  "ui.create_note": "Notiz „{value0}“ erstellen",
  "count.notes": "{count, plural, one {# Notiz} other {# Notizen}}"
}
```

Keep argument names such as `{value0}`, `{title}`, `{error}` and `{count}` unchanged. You can move them within the sentence. The app replaces them with actual values.

For plural messages, translate every branch and keep `other`. Add any plural categories your language needs: `zero`, `one`, `two`, `few`, `many`, `other`. Russian, for example:

```json
{
  "count.notes": "{count, plural, one {# заметка} few {# заметки} many {# заметок} other {# заметки}}"
}
```

`#` inserts the count. Do not replace it with a fixed number.

### Keep these unchanged

- Message keys and argument names.
- Shortcut codes such as `Ctrl`, `Shift`, `Enter` and `Alt`.
- Product names, URLs, file extensions and literal Markdown syntax where they identify an actual format or command.
- JSON punctuation. Use double quotes; escape a double quote inside a value as `\"`. JSON does not support comments or trailing commas.

Use consistent terminology for notes, notebooks, vaults, tags and backups. Prefer clear wording over a literal translation. Do not add HTML to messages. ICU uses apostrophes for quoting; a literal apostrophe can be escaped as `''` when needed.

An incomplete translation is welcome. Leave untranslated values in English instead of deleting their keys, and say which sections remain unfinished.

## Submit through a GitLab issue

1. Open a new issue and select the **Translation** description template.
2. Use a title such as `Translation: German (de)`.
3. Give the English language name, native name and language/region code.
4. Attach your translated JSON file. If GitLab refuses the extension, attach a ZIP containing it.
5. State which English catalog version you used, whether the translation is complete, and any wording or layout concerns.
6. Say how you would like to be credited, if at all.

You do not need to make a merge request or edit the app's language selector. The maintainer reviews the file, runs catalog checks, registers the language and includes it in a future release. Attaching a file to an issue does not immediately install it in the app.

If you can test a development build, screenshots of clipped labels are useful. If you cannot, submit the file anyway. Right-to-left languages also need layout testing before release.

## Maintainer checks

See the [implementation guide](../../src/lib/i18n/README.md) for registering a language and running validation. Check catalog keys, ICU syntax, argument names, plural forms, native labels and layout before shipping. Do not modify user notes as part of language integration.
