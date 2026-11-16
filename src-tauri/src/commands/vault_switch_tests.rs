use super::*;

fn config_for(path: &str, bookmark: Option<&str>) -> AppConfig {
    AppConfig {
        active_vault: Some(path.into()),
        active_bookmark_id: bookmark.map(String::from),
        vaults: vec![VaultConfig {
            path: path.into(),
            name: "Work".into(),
            bookmark_id: bookmark.map(String::from),
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn expected_origin_checks_both_path_and_bookmark_without_touching_config() {
    let config = config_for("/vault/Work", Some("bookmark-a"));
    let before = serde_json::to_value(&config).unwrap();
    for expected in [
        VaultIdentity {
            path: "/other/Work".into(),
            bookmark_id: Some("bookmark-a".into()),
        },
        VaultIdentity {
            path: "/vault/Work".into(),
            bookmark_id: Some("bookmark-b".into()),
        },
        VaultIdentity {
            path: "/vault/Work".into(),
            bookmark_id: None,
        },
    ] {
        assert!(validate_vault_origin(&config, Some(&expected))
            .unwrap_err()
            .contains("active vault changed"));
    }
    assert!(validate_vault_origin(
        &config,
        Some(&VaultIdentity {
            path: "/vault/Work".into(),
            bookmark_id: Some("bookmark-a".into())
        })
    )
    .is_ok());
    assert!(validate_vault_origin(&config, None).is_ok());
    assert_eq!(serde_json::to_value(&config).unwrap(), before);
}

#[test]
fn activation_rejects_empty_and_relative_paths_before_initializing_them() {
    for path in ["", "relative/Work", "../outside"] {
        assert!(validate_vault_path(path).is_err());
    }
    let root = tempfile::tempdir().unwrap();
    assert!(validate_vault_path(root.path().to_str().unwrap()).is_ok());
}

#[test]
fn saved_local_vault_requires_a_registered_directory() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().to_str().unwrap();
    operations::ensure_vault_structure(path).unwrap();
    let metadata = std::fs::read(root.path().join(".helixnotes/config.json")).unwrap();
    assert!(validate_saved_vault(&config_for(path, None), path).is_ok());
    assert_eq!(
        std::fs::read(root.path().join(".helixnotes/config.json")).unwrap(),
        metadata
    );
    assert!(validate_saved_vault(&AppConfig::default(), path)
        .unwrap_err()
        .contains("saved list"));
    let unrelated = tempfile::tempdir().unwrap();
    assert!(
        validate_saved_vault(&AppConfig::default(), unrelated.path().to_str().unwrap()).is_err()
    );
    assert!(!unrelated.path().join(".helixnotes").exists());
}

#[test]
fn an_empty_mount_point_is_not_initialized_as_a_replacement_vault() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().to_str().unwrap();
    assert!(validate_saved_vault(&config_for(path, None), path)
        .unwrap_err()
        .contains("metadata"));
    assert!(!root.path().join(".helixnotes").exists());
}

#[test]
fn missing_saved_folders_are_not_recreated_or_removed_from_the_list() {
    let root = tempfile::tempdir().unwrap();
    let missing = root.path().join("disconnected-drive/Work");
    let path = missing.to_str().unwrap();
    let config = config_for(path, None);
    assert!(validate_saved_vault(&config, path)
        .unwrap_err()
        .contains("unavailable"));
    assert!(!missing.exists());
    assert!(!missing.parent().unwrap().exists());
    assert_eq!(config.vaults.len(), 1);
    assert_eq!(config.active_vault.as_deref(), Some(path));
}

#[test]
fn bookmark_vaults_must_be_resolved_by_bookmark_not_opened_as_local_paths() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().to_str().unwrap();
    let config = config_for(path, Some("security-scoped-bookmark"));
    assert!(validate_saved_vault(&config, path).is_err());
    assert!(!root.path().join(".helixnotes").exists());
}

#[test]
fn a_saved_path_that_is_now_a_file_is_rejected_unchanged() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("Work");
    std::fs::write(&file, "not a directory").unwrap();
    let path = file.to_str().unwrap();
    assert!(validate_saved_vault(&config_for(path, None), path).is_err());
    assert_eq!(std::fs::read_to_string(file).unwrap(), "not a directory");
}
