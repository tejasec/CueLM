# Live Preview

Work for 1.3.8, in release preparation. Version 1.3.8 has not yet been published.

## Choose an editor mode

Use the existing source-code icon and its dropdown to choose **Rich text**, **Live preview** or **Markdown source**. The desktop editor, detached windows and tablet toolbar use the same compact selector. On phones, the three choices are in the note's **More** menu. They are also available in the command palette.

Edit/View remains a separate control. Choosing Live preview does not make a read-only note editable.

Live preview is an editable Markdown surface, not a split screen or a read-only rendered page. It shares its CodeMirror document with Markdown source. Switching between those two modes preserves the document, selection, undo/redo history and viewport anchor without converting HTML, marking the note dirty or triggering a save. Switching to or from Rich text still uses the existing editor-conversion path.

The current presentation is remembered for the window/session, not stored in the vault or synchronized. The existing source/rich-text shortcut returns to whichever Markdown presentation you last chose.

In **Settings → Editor → New note editor**, three joined buttons choose **Rich text**, **Live preview** or **Markdown source** for new empty notes. Fresh profiles default to Rich text; an existing “Open new notes in source mode” preference keeps Source selected. The preference is saved on this device. It does not change the current editor, existing notes, or the separate Edit/View preference. A failed save keeps the previous button selected and shows an error. The setting’s title and description occupy their own full-width row above the buttons.

## Editing

- Headings, bold, italic, strikethrough and inline code are styled inline.
- Syntax on the caret's line, or lines touched by a selection, remains visible for direct editing. A fenced code block reveals its fences while the selection is inside it.
- Inline Markdown links show their labels. Ctrl/Cmd-click opens a rendered link; Ctrl/Cmd-Enter opens the link under the caret.
- Bullet lists, blockquotes, horizontal rules and fenced code blocks have preview styling. Code contents stay literal source, not executable content.
- Task checkboxes are clickable away from the active line. Toggling changes only the checkbox character in Markdown and is undoable. Checkboxes are disabled in View mode.
- Inline Markdown images render through the existing asset/image-proxy resolver. Select an image to reveal and select its Markdown. Broken images retain a selectable source control.
- Copy and Find/Replace work against the Markdown document, not a generated HTML copy. Search selections reveal the syntax they touch.
- Live preview wraps lines and hides line numbers. Markdown source restores the existing line-number setting.

There is no separate preview buffer to save. Typing and checkbox edits use the existing source editor's save, conflict and history handling. Moving the caret, rendering an image, changing language or changing presentation does not edit the note.

## Initial scope

This is an initial Obsidian-style editing mode, not complete Obsidian compatibility. Tables, raw HTML, math, Mermaid diagrams, wiki links and reference-style links remain editable as source rather than receiving a second, potentially lossy interpretation. Very long paragraphs also stay source to bound rendering work. Imported HTML tables and other unsupported constructs are not rewritten by the preview.

Raw HTML is never inserted into preview DOM. Preview URLs reject executable schemes. Local files and remote images use the same scoped asset and image-proxy paths as the existing editor; previewing a remote image may contact its server, just as in rich text.

## Verification

```sh
pnpm verify
pnpm exec playwright install chromium   # once, if a compatible browser is not installed
pnpm test:browser
```

The checked-in browser fixture uses the production SourceEditor, SourceController and mode selector. It exercises rendering, source/live switching, selection and copying, task edits, undo/redo, read-only guards, links, images, localization, narrow layouts, viewport preservation, large-note virtualization and unsafe-content fallback. It does not mock a successful preview operation or need a native vault.

Before release, also test the complete rebuilt app: rich-text transitions, saves/restarts, external changes and conflicts, AI actions, attachment insertion, detached windows, mobile touch selection and real IME input. The isolated browser fixture does not prove native-webview or end-to-end vault behaviour.
