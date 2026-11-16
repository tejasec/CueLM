use super::{conflict_copy, is_synced_relpath, scan_local};
use crate::vault::daily_template as template;
use std::fs;

#[test]
fn sync_includes_only_the_designated_template_metadata_file() {
    assert!(is_synced_relpath(template::RELATIVE_PATH));
    for path in [
        ".helixnotes/history/daily-template.md",
        ".helixnotes/daily-template.json",
        ".helixnotes/other.md",
        ".HelixNotes/daily-template.md",
    ] {
        assert!(!is_synced_relpath(path), "{path}");
    }
    let dir = tempfile::tempdir().unwrap();
    let vault = dir.path().to_str().unwrap();
    template::set(vault, Some("{{date}}\n- [ ] Task"), None).unwrap();
    fs::write(dir.path().join(".helixnotes/private.md"), "Private").unwrap();
    fs::write(dir.path().join("Note.md"), "Note").unwrap();
    let files = scan_local(vault).unwrap();
    assert_eq!(files.len(), 2);
    assert!(files.contains_key(template::RELATIVE_PATH));
    assert!(files.contains_key("Note.md"));
}

#[test]
fn metadata_conflict_copies_preserve_template_bytes_instead_of_rewriting_note_titles() {
    let raw = b"---\nhelixnotes_daily_template_enabled: false\ntitle: Not a note\n---\n# {{title}}\n{{date}}\n".to_vec();
    assert_eq!(
        conflict_copy(
            ".helixnotes/daily-template (conflict x).md",
            raw.clone(),
            "x"
        ),
        raw
    );
}
