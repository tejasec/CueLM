use super::{create_backup, restore_backup};
use crate::vault::daily_template as template;
use std::{fs, io::Write};
use zip::write::SimpleFileOptions;

fn archive(path: &std::path::Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    for (name, bytes) in entries {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
}

#[test]
fn templates_are_backed_up_without_attachments_and_restore_enabled_and_disabled_state() {
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    fs::write(dir.path().join("Note.md"), "Original note\n").unwrap();
    template::set(vault, Some("# {{title}}\n- [ ] Task\n"), None).unwrap();
    let snapshot = create_backup(vault, output.path(), false).unwrap();
    let current = template::read(vault).unwrap();
    template::set(vault, Some("Later template"), current.as_deref()).unwrap();
    fs::write(dir.path().join("Note.md"), "Edited note\n").unwrap();
    restore_backup(vault, output.path(), &snapshot.path).unwrap();
    let restored = template::DailyTemplate::from_raw(template::read(vault).unwrap());
    assert!(restored.enabled);
    assert_eq!(restored.content, "# {{title}}\n- [ ] Task\n");
    assert_eq!(
        fs::read_to_string(dir.path().join("Note.md")).unwrap(),
        "Original note\n"
    );
    let disabled = template::set(vault, None, restored.raw.as_deref()).unwrap();
    let snapshot = create_backup(vault, output.path(), false).unwrap();
    template::set(vault, Some("Enabled later"), disabled.as_deref()).unwrap();
    restore_backup(vault, output.path(), &snapshot.path).unwrap();
    let restored = template::DailyTemplate::from_raw(template::read(vault).unwrap());
    assert!(!restored.enabled);
    assert_eq!(restored.content, "# {{title}}\n- [ ] Task\n");
}

#[test]
fn restoring_a_new_snapshot_without_a_template_restores_that_absence() {
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    fs::write(dir.path().join("Note.md"), "Note").unwrap();
    let snapshot = create_backup(vault, output.path(), false).unwrap();
    template::set(vault, Some("Added after backup"), None).unwrap();
    restore_backup(vault, output.path(), &snapshot.path).unwrap();
    assert_eq!(template::read(vault).unwrap(), None);
}

#[test]
fn legacy_backups_leave_the_existing_template_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    template::set(vault, Some("Keep this template"), None).unwrap();
    let path = output.path().join("legacy.zip");
    let manifest = serde_json::to_vec(&serde_json::json!({
        "version": 1, "vault": super::vault_id(dir.path()).unwrap(), "attachments": false,
    }))
    .unwrap();
    for with_manifest in [false, true] {
        let mut entries: Vec<(&str, &[u8])> = vec![("Note.md", b"Legacy note")];
        if with_manifest {
            entries.push((super::MANIFEST, &manifest));
        }
        archive(&path, &entries);
        restore_backup(vault, output.path(), path.to_str().unwrap()).unwrap();
        assert_eq!(
            template::read(vault).unwrap().as_deref(),
            Some("Keep this template")
        );
    }
    assert_eq!(
        template::read(vault).unwrap().as_deref(),
        Some("Keep this template")
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("Note.md")).unwrap(),
        "Legacy note"
    );
}

#[test]
fn template_only_backups_cannot_erase_the_current_notes() {
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    template::set(vault, Some("Only a template"), None).unwrap();
    let snapshot = create_backup(vault, output.path(), false).unwrap();
    fs::write(dir.path().join("Keep.md"), "Keep me").unwrap();
    assert!(restore_backup(vault, output.path(), &snapshot.path).is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join("Keep.md")).unwrap(),
        "Keep me"
    );
}

#[test]
fn oversized_and_binary_templates_are_rejected_before_the_live_vault_changes() {
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    fs::write(dir.path().join("Keep.md"), "Keep me").unwrap();
    template::set(vault, Some("Original template"), None).unwrap();
    for bytes in [vec![b'x'; template::MAX_BYTES + 1], vec![0xff]] {
        let path = output.path().join("bad.zip");
        archive(
            &path,
            &[
                ("Note.md", b"Replacement"),
                (template::RELATIVE_PATH, &bytes),
            ],
        );
        assert!(restore_backup(vault, output.path(), path.to_str().unwrap()).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("Keep.md")).unwrap(),
            "Keep me"
        );
        assert_eq!(
            template::read(vault).unwrap().as_deref(),
            Some("Original template")
        );
    }
}

#[test]
fn failed_install_rolls_back_the_template_notes_and_historical_backups() {
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    fs::write(dir.path().join("Keep.md"), "Keep me").unwrap();
    fs::create_dir(dir.path().join("History")).unwrap();
    let historical = dir.path().join("History/helixnotes-backup-kept.zip");
    fs::write(&historical, "Historical backup").unwrap();
    template::set(vault, Some("Original template"), None).unwrap();
    let path = output.path().join("rollback.zip");
    // Installation reaches the template swap, then cannot reinsert the historical ZIP
    // because the archive replaced its containing directory with a regular file.
    archive(
        &path,
        &[
            ("History", b"not a directory"),
            ("Replacement.md", b"Replacement"),
            (template::RELATIVE_PATH, b"New template"),
        ],
    );
    assert!(restore_backup(vault, output.path(), path.to_str().unwrap()).is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join("Keep.md")).unwrap(),
        "Keep me"
    );
    assert_eq!(
        template::read(vault).unwrap().as_deref(),
        Some("Original template")
    );
    assert_eq!(fs::read_to_string(historical).unwrap(), "Historical backup");
    assert!(!dir.path().join("Replacement.md").exists());
}

#[cfg(unix)]
#[test]
fn template_restore_cannot_write_through_a_metadata_directory_symlink() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    fs::write(dir.path().join("Keep.md"), "Keep me").unwrap();
    let path = output.path().join("template.zip");
    archive(
        &path,
        &[
            ("Note.md", b"Replacement"),
            (template::RELATIVE_PATH, b"Template"),
        ],
    );
    symlink(outside.path(), dir.path().join(".helixnotes")).unwrap();
    assert!(restore_backup(vault, output.path(), path.to_str().unwrap()).is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join("Keep.md")).unwrap(),
        "Keep me"
    );
    assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
}
