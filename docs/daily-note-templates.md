# Daily-note templates

Open **Settings → General → Daily note template** in the vault you want to configure.

- **Create template** opens a Markdown editor. Save to enable it.
- **Import Markdown file…** imports a copy of a UTF-8 `.md` file. The source file is not changed. Later edits to the source are not imported automatically.
- **Edit** changes the saved copy. Saving enables the template.
- **Disable template** stops applying it without deleting its contents. **Enable template** uses that saved body again.
- **Reload from disk** reads changes made in another window, by sync or in an external editor. Cancel editing first; copy any unsaved draft you want to keep before cancelling.

## Example

```markdown
# {{title}}

Date: {{date}}

## Priorities
- [ ]

## Notes

## End-of-day review
```

Only two placeholders are supported:

| Placeholder | Value |
| --- | --- |
| `{{date}}` | The selected calendar date as `YYYY-MM-DD`. This can be a past or future date, not necessarily today. |
| `{{title}}` | The daily-note title using the format selected in Settings. |

Placeholders are case-sensitive. Unknown placeholders remain literal text. There are no scripts or executable expressions.

The body layout is preserved, including headings, blank lines and Markdown hard breaks. No extra title heading is inserted. Links and attachment paths are copied as written; importing a template does not import its attachments or rewrite its links.

## What stays unchanged

The template applies only when creating a daily note. Opening an existing daily note never replaces or appends to its contents, even if the template has since changed or cannot be read.

Imported frontmatter is not copied. Each new daily note receives its own ID, timestamps, configured title and `daily` tag. Changing the interface language does not translate or rewrite the saved template or its draft.

The template must fit within 256 KiB, including its stored metadata. Invalid UTF-8, oversized files and disk errors are reported instead of silently creating a partial note. Concurrent creation of the same day publishes one complete note without overwriting an existing file.

## Storage, sync and backups

The saved template belongs to the vault, not the device-wide application settings:

```text
.helixnotes/daily-template.md
```

It is excluded from normal note lists, search and Tasks. Its checklist items appear in Tasks only after they have been copied into an actual daily note.

Disabling retains the body in the same file, with this frontmatter flag:

```yaml
helixnotes_daily_template_enabled: false
```

The file is included in the next WebDAV sync. Conflicting copies retain their original template text and are kept under `.helixnotes`; they are not automatically chosen as the active template.

New backups include the saved template even when attachments are excluded. Restoring a new backup restores its template state too, including whether it was disabled or absent. Older backups that do not record template state leave the current template alone.

Saving checks that the file still matches the version loaded by Settings. If it changed elsewhere, the save is rejected and your draft remains in the editor. Reload the latest copy before deciding what to save.
