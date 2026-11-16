use super::{daily_template as template, operations};
use std::collections::HashSet;
use std::fs;

#[test]
fn daily_template_uses_the_selected_date_fresh_metadata_and_exact_body_layout() {
    let root = tempfile::tempdir().unwrap();
    let vault = root.path().to_str().unwrap();
    let source = "---\r\nid: template-id\r\ntitle: Do not copy\r\ntags: [private]\r\npinned: true\r\ncreated: 2000-01-01\r\n---\r\n## {{title}}\r\n\r\nDate: {{date}}  \r\n- [ ] Plan\r\n<table><tr><td>keep</td></tr></table>\r\n";
    template::set(vault, Some(source), None).unwrap();
    let entry = operations::create_daily_note(vault, Some("2020-02-29"), "long").unwrap();
    assert_eq!(
        entry.relative_path.replace('\\', "/"),
        "Daily/2020-02-29.md"
    );
    assert_eq!(entry.meta.title, "February 29, 2020");
    assert_ne!(entry.meta.id, "template-id");
    uuid::Uuid::parse_str(&entry.meta.id).unwrap();
    assert_eq!(entry.meta.tags, ["daily"]);
    assert!(!entry.meta.pinned);
    assert!(
        entry.meta.created > chrono::DateTime::parse_from_rfc3339("2020-01-01T00:00:00Z").unwrap()
    );
    let raw = fs::read_to_string(&entry.path).unwrap();
    assert_eq!(template::body(&raw), "## February 29, 2020\r\n\r\nDate: 2020-02-29  \r\n- [ ] Plan\r\n<table><tr><td>keep</td></tr></table>\r\n");
    assert!(!raw.contains("template-id"));
    assert_eq!(
        template::read(vault).unwrap().as_deref(),
        Some(template::body(source))
    );
}

#[test]
fn existing_daily_notes_are_never_retemplated_even_if_the_template_is_broken() {
    let root = tempfile::tempdir().unwrap();
    let vault = root.path().to_str().unwrap();
    template::set(vault, Some("First {{date}}\n"), None).unwrap();
    let first = operations::create_daily_note(vault, Some("2026-06-01"), "iso").unwrap();
    let original = fs::read(&first.path).unwrap();
    fs::write(root.path().join(template::RELATIVE_PATH), [0xff]).unwrap();
    let reopened = operations::create_daily_note(vault, Some("2026-06-01"), "eu").unwrap();
    assert_eq!(reopened.meta.id, first.meta.id);
    assert_eq!(fs::read(&first.path).unwrap(), original);
    assert!(operations::create_daily_note(vault, Some("2026-06-02"), "iso").is_err());
    assert!(!root.path().join("Daily/2026-06-02.md").exists());
}

#[test]
fn disable_and_reenable_preserve_the_template_without_touching_existing_notes() {
    let root = tempfile::tempdir().unwrap();
    let vault = root.path().to_str().unwrap();
    let saved = template::set(vault, Some("{{title}} — {{date}}\n"), None).unwrap();
    let first = operations::create_daily_note(vault, Some("2026-07-01"), "iso").unwrap();
    let before = fs::read(&first.path).unwrap();
    let disabled = template::set(vault, None, saved.as_deref()).unwrap();
    let blank = operations::create_daily_note(vault, Some("2026-07-02"), "iso").unwrap();
    assert_eq!(
        template::body(&fs::read_to_string(blank.path).unwrap()),
        "\n"
    );
    let state = template::DailyTemplate::from_raw(disabled.clone());
    assert!(!state.enabled);
    template::set(vault, Some(&state.content), disabled.as_deref()).unwrap();
    let next = operations::create_daily_note(vault, Some("2026-07-03"), "iso").unwrap();
    assert_eq!(
        template::body(&fs::read_to_string(next.path).unwrap()),
        "2026-07-03 — 2026-07-03\n"
    );
    assert_eq!(fs::read(&first.path).unwrap(), before);
}

#[test]
fn concurrent_daily_creation_publishes_one_complete_note_and_cleans_temporary_files() {
    let root = tempfile::tempdir().unwrap();
    let vault = root.path().to_str().unwrap();
    template::set(vault, Some("# {{title}}\n\n{{date}}\n"), None).unwrap();
    let entries = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..6)
            .map(|_| {
                scope.spawn(|| {
                    operations::create_daily_note(vault, Some("2026-08-01"), "iso").unwrap()
                })
            })
            .collect();
        workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(
        entries
            .iter()
            .map(|entry| &entry.meta.id)
            .collect::<HashSet<_>>()
            .len(),
        1
    );
    assert_eq!(fs::read_dir(root.path().join("Daily")).unwrap().count(), 1);
    assert_eq!(
        template::body(&fs::read_to_string(&entries[0].path).unwrap()),
        "# 2026-08-01\n\n2026-08-01\n"
    );
}

#[test]
fn template_checkboxes_do_not_become_notes_or_tasks_and_vaults_are_independent() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let vault = a.path().to_str().unwrap();
    template::set(vault, Some("- [ ] Template-only task\n"), None).unwrap();
    assert!(operations::scan_notes(vault, None).unwrap().is_empty());
    let note = operations::create_daily_note(b.path().to_str().unwrap(), Some("2026-01-01"), "iso")
        .unwrap();
    assert_eq!(
        template::body(&fs::read_to_string(note.path).unwrap()),
        "\n"
    );
}
