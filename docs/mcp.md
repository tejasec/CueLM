# Connect an AI client to HelixNotes

Desktop integration for **1.3.8**, in release preparation. No 1.3.8 release tag or npm package has been published.

## Set it up

MCP is desktop-only. Android and iOS do not include its native runtime or commands, do not install its editor listeners, and do not show the Integrations tab in Settings. Mobile vault switching remains a separate feature and uses the platform's existing storage access flow.

Use an AI client that supports **local stdio MCP servers**. Web-only clients that accept only remote MCP URLs cannot use this configuration; the private bridge URL is not a public MCP endpoint.

1. Open **Settings → Integrations → MCP access** in a rebuilt HelixNotes desktop app.
2. Choose a saved vault. This selects the MCP scope; it does **not** switch the vault open in the editor.
3. Enable **Allow MCP access to this vault**. Access starts **read-only**.
4. Click **Copy client configuration** and paste the JSON into your AI client's MCP-server settings. The location and configuration format around this entry depend on the client.
5. Keep HelixNotes running and connect/reconnect the AI client.

The helper is part of the HelixNotes executable. Users do **not** need Node.js, pnpm, a Git checkout, a separate helper download or a manually started server.

To allow edits, select **Allow editing** and confirm the warning for the named vault. Reconnect the AI client so it discovers the extra tool. To revoke access, turn the switch off. Saved permissions remain visible and can be disabled even if that vault's storage is unavailable. Forgetting and re-adding a vault does not restore its old grant.

Each connection stays bound to its chosen vault. Switching the main app to another vault does not retarget it. If connecting several vaults, give the copied `mcpServers` entries different names, such as `helixnotes-work` and `helixnotes-personal`; do not overwrite one entry with another.

## What the client launches

A typical copied entry looks like this; use the app-generated paths, not these placeholders:

```json
{
  "mcpServers": {
    "helixnotes": {
      "command": "/installed/path/to/helixnotes",
      "args": [
        "--mcp-stdio",
        "--connection",
        "/private/app/config/helixnotes/mcp/connection-id.json"
      ]
    }
  }
}
```

The executable recognizes this mode **before** starting Tauri/WebKit or the single-instance GUI plugin. It runs the official Rust MCP SDK over stdio and talks to the running application through a private authenticated loopback bridge. It does not open a second GUI window or independently write vault files.

AppImage configuration uses the persistent outer AppImage, not a temporary mount path. Flatpak configuration launches the helper through `flatpak run --command=helixnotes`. Normal Windows/macOS/Linux installations use the installed executable path. If you move or replace the application at a different location, copy a new configuration.

## Available tools

| Tool | Permission and behavior |
| --- | --- |
| `list_notes` | Read-only. Paginated visible `.md` paths within the granted vault, with folder scope and listing snapshots. |
| `read_note` | Read-only. Original YAML, known/custom metadata, diagnostics, SHA-256 revision and paginated body. Saved disk state only; not unsaved editor drafts. |
| `search_notes` | Read-only. Bounded, case-insensitive literal search of raw Markdown, including YAML. Not Tantivy query syntax. |
| `validate_note` | Read-only. Inspect proposed Markdown/frontmatter; explicitly returns `applied: false`. Not an overwrite/conflict check. |
| `get_feature_guide` | Read-only. App features, frontmatter schema, editing rules, Markdown/tasks, daily templates, Live preview, AI and vault-switching documentation. |
| `edit_note` | Requires explicit editing permission. One unique literal body replacement and/or changes to title, tags and pinned state. Requires the exact revision returned by `read_note`. |

`edit_note` does not accept a replacement frontmatter block or changes to IDs, creation dates or arbitrary custom keys. It does not rename files or rewrite backlinks. Title changes are metadata changes, not a rename/refactor tool. There are no create, move, delete, restore, sync, template-writing, decryption or AI-request tools yet. A feature described in a guide is not automatically an executable MCP operation.

## Editing safety and frontmatter

Before an edit, save open drafts in **all windows of this app instance**, not just the target note. Busy/startup/unresponsive windows and active IME composition also block writing. The application freezes input and pending note navigation, verifies every window's acknowledgement, then rechecks the note revision under its normal note-save mutex.

Successful writes use the shared native commit path: expected-raw conflict checking, atomic replacement, normal history snapshots, search updates and file-change notifications. IDs, creation dates and unknown YAML keys are preserved by native metadata merging. Normal native saves may reserialize YAML or adjust the leading title heading; byte-for-byte preservation of comments/formatting is not promised. History follows the app's existing behavior, including its body-only restore semantics.

Clean open editors reload changed data before becoming editable again, retaining their current Source/Live/Rich presentation and Edit/View choice. Unchanged finishes do not reload the document or clear undo history. A webview reload waits for an already accepted write before loading editable notes. A lost finish event is recovered only after querying the native owner—not by guessing a safe timeout.

A submitted edit may finish even if the MCP client disconnects or cancels. That prevents a blocking disk write from continuing after the editor was prematurely unlocked. Cancellation is not Undo: reread the note before retrying. Closing/quitting is blocked while a native MCP edit is active.

General body edits to notes containing `helix-secret` are conservatively refused; use the app's secret-aware editor. Native MCP writes also require complete, canonical metadata and a stable note ID. Legacy/incomplete or complex frontmatter remains readable, but must first be opened/saved in HelixNotes before MCP editing. Inspection itself never invents IDs or timestamps or repairs a file.

Normal app behavior can react to a saved edit, including previously configured automatic sync/backups. The MCP tools do not independently request sync or send notes to an AI provider.

## Knowledge resources

- `helixnotes://schema/frontmatter`: `id`, `title`, `tags`, `pinned`, `created`, `modified`; custom keys remain permitted.
- `helixnotes://guide/features`: the repository README's complete Features section.
- `helixnotes://guide/frontmatter`: schema, legacy forms and preservation rules.
- `helixnotes://guide/editing`: native editing contract and limitations.
- `helixnotes://guide/markdown`: task flags, links, custom blocks, math/diagrams, images and secrets.
- Guides also exist for `daily-templates`, `live-preview`, `ai-models-and-images` and `vault-switching`.

YAML integers are represented as strings in fields JSON to avoid rounding large legacy IDs. Original YAML is authoritative. The native reader and save path remain the authority for actual writes, not a model's reconstructed header.

## Privacy and local authorization

A local MCP helper does **not** imply a local model. Your AI client can forward returned note contents to its configured model provider. Grant access deliberately. Resources provide context on demand; they do not train the model. These permissions limit this MCP connection, not other tools or OS access the AI client already has.

Only the selected vault is shared. Internal/hidden paths, trash, history, backups, indexes, settings, credentials, resource folders and descendant symlinks are excluded from note tools. Note contents, filenames and metadata are untrusted data, not instructions.

MCP is disabled by default; no bridge listener starts without an enabled saved grant. The bridge binds only to `127.0.0.1` on an ephemeral port. It is a private helper protocol, **not** a public Streamable HTTP MCP endpoint. Browser origins, unexpected Host headers, replayed requests and oversized requests are rejected.

Secrets stay in private device-local files outside the vault. Unix files/directories use 0600/0700 with ownership checks; Windows files/directories receive protected owner-rights ACLs. The copied configuration contains only a connection-file path, not a token. Requests and responses are separately HMAC-authenticated, secrets never travel as bearer headers, keys rotate on app startup and permission changes, and the helper disables proxy use and redirects. A stale local port cannot provide an authenticated fake response. Reconnect clients after changing permissions. If the system clock changed substantially, save drafts and restart HelixNotes.

Filesystem scoping is not an OS sandbox against another hostile process concurrently replacing the directory tree. Use OS permissions/sandboxing where the filesystem itself is untrusted. The app's existing conflict checks cannot provide a filesystem-wide atomic transaction with unrelated third-party editors.

## Limits

Reads are bounded to 2 MiB per note. Body responses default to 16,000 UTF-16 units, at most 64,000 per page; `maxChars` must be at least 2. Returned cursors never split a Unicode character. Use `expectedRevision` for later pages.

YAML is capped at 64 KiB with conservative nesting/complexity guards. MCP inspection rejects aliases, anchors, custom tags, complex keys and non-finite numbers rather than risking a destructive interpretation. This is stricter than the normal app reader.

Scans stop after 10,000 entries/depth 32 and report truncation. Search examines at most 100 files per call and an 8 MiB starting budget, plus at most one final note. Continue with the returned cursor and listing snapshot. Oversized/unreadable notes count as skipped. Busy native vault/maintenance operations can require retrying an edit.

## Development and verification

```bash
pnpm test:mcp          # original read-only adapter and schema/scope tests
pnpm test:mcp:native   # builds the app/helper, tests real stdio against the TS SDK client
pnpm test:browser      # real Settings and editor gate/presentation/undo checks
pnpm verify
```

`packages/mcp` retains the initial Node read-only filesystem adapter as a development/reference implementation, with `pnpm mcp:dev-readonly --vault /absolute/path`. It is not the packaged user integration and cannot write notes. The installed integration uses the Rust helper and the running app.

Tests use temporary vaults and mocked GUI acknowledgements for native protocol tests; browser tests separately exercise production Settings and the actual Editor gate. No real user vaults or paid providers are used. Rebuilt Windows/macOS, AppImage/Flatpak launcher behavior, OS ACLs and native dialogs still need real-platform testing before release. Flatpak offline sources and the pinned build revision also need release preparation after dependency changes.
