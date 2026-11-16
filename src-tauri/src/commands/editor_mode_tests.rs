use super::*;

#[test]
fn new_note_preferences_round_trip_without_changing_other_settings() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("config.json");
    let mut config = AppConfig {
        theme: "custom".into(),
        active_vault: Some("/notes/Work".into()),
        ..Default::default()
    };
    for mode in [
        NewNoteEditorMode::Rich,
        NewNoteEditorMode::Live,
        NewNoteEditorMode::Source,
    ] {
        persist_new_note_editor_mode(&mut config, mode, &path).unwrap();
        let saved: AppConfig = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.new_note_editor_mode, Some(mode));
        assert_eq!(
            saved.new_notes_in_source_mode,
            mode != NewNoteEditorMode::Rich
        );
        assert_eq!(saved.theme, "custom");
        assert_eq!(saved.active_vault.as_deref(), Some("/notes/Work"));
    }
}

#[test]
fn failed_preference_save_retains_the_previous_in_memory_value() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("config.json");
    std::fs::create_dir(&path).unwrap();
    let mut config = AppConfig::default();
    let before = serde_json::to_value(&config).unwrap();
    assert!(persist_new_note_editor_mode(&mut config, NewNoteEditorMode::Live, &path).is_err());
    assert_eq!(serde_json::to_value(&config).unwrap(), before);
    assert!(path.is_dir());
}

#[test]
fn missing_or_invalid_new_fields_preserve_legacy_source_preferences() {
    for legacy in [false, true] {
        let mut value = serde_json::to_value(AppConfig::default()).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .remove("new_note_editor_mode");
        value["new_notes_in_source_mode"] = serde_json::json!(legacy);
        let restored: AppConfig = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(restored.new_note_editor_mode, None);
        assert_eq!(restored.new_notes_in_source_mode, legacy);
        value["new_note_editor_mode"] = serde_json::json!("invalid-mode");
        let restored: AppConfig = serde_json::from_value(value).unwrap();
        assert_eq!(restored.new_note_editor_mode, None);
        assert_eq!(restored.new_notes_in_source_mode, legacy);
    }
    assert!(serde_json::from_str::<NewNoteEditorMode>("\"invalid-mode\"").is_err());
}
