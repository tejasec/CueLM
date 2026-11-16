# Quick vault switching

Work for 1.3.8, in release preparation. Version 1.3.8 has not yet been published.

The desktop title bar shows the current vault name beside the app name. Open its dropdown to switch directly to another saved vault. Each row shows its name and folder path, with a checkmark on the current vault. Paths distinguish vaults with identical names; long names truncate in the title bar but remain readable in the menu.

- **Add vault…** opens the desktop folder chooser. Choose an existing notes folder, or create a folder using the system dialog where available. Opening it registers the vault.
- **Manage Vaults** opens the existing management screen, where vaults can be removed from the saved list. The quick menu does not contain removal actions.
- Choosing the current vault is a no-op: it does not save, reload or discard its draft.

The mobile home and note headers expose the same dropdown. Mobile **Add vault…** opens the existing platform-specific picker, retaining Android storage permissions and iOS local-folder/Files choices.

## Switching safely

A switch saves the current note and persists its vault layout before opening the destination. The old editor is frozen until activation succeeds and the new vault's layout replaces it. Native activation returns the committed configuration in the same response; there is no second config read that could fail after changing the native vault.

A save failure or an operation already using the editor blocks the switch. An unavailable destination leaves the previous vault and its text available. Only one switch can run at a time. Failed operations release the editing gate so they can be retried.

Saved-vault opens require an existing, registered folder and its initialized HelixNotes metadata. Missing folders and empty mount-point placeholders are not silently initialized as replacement vaults. Reconnect the storage or explicitly choose the folder again through Add/Manage. New folder initialization remains an explicit Add action.

The native operation checks the expected source vault's path and bookmark identity. iOS Files vaults restore by bookmark, allowing their provider path to change. Layouts are keyed by path and bookmark, and delayed sync events are scoped to that identity. Detached note windows keep their original vault; switching the main window does not move them or delete their files.

## Keyboard and appearance

- Enter/Space or Arrow Down opens the menu.
- Arrow Up/Down, Home/End and type-ahead move between choices.
- Escape or Tab closes the menu and returns focus to its trigger.
- Clicking outside dismisses it when no transition is running.

The menu follows app theme tokens, scrolls within the viewport and supports narrow screens. Its controls are excluded from title-bar dragging and double-click maximize handling.

## Verification

Run `pnpm verify` and `pnpm test:browser`. Unit tests cover transition ordering, cancellation, overlapping requests, failures, stale origins, preference preservation, atomic IPC responses and bookmark identity. Rust tests cover saved-folder validation and non-mutating rejection of missing folders, missing metadata, invalid paths and bookmark-only vaults. Browser tests use the production title bar, dropdown, source editor and coordinator with mocked native/save boundaries.

Before release, test rebuilt desktop/mobile apps with real file choosers, unavailable/removable storage, detached windows, background sync and iOS security-scoped folders. Browser mocks do not verify those platform boundaries.
