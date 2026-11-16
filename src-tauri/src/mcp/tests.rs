use super::*;
use crate::{
    state::AppState,
    types::{AppConfig, VaultConfig},
    vault::operations,
};
use tauri::Listener;

struct Fixture {
    _temp: tempfile::TempDir,
    app: tauri::App<tauri::test::MockRuntime>,
    core: Arc<Core<tauri::test::MockRuntime>>,
    vault: VaultRef,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Ok(mut listener) = self.core.listener.try_lock() {
            listener.take();
        }
    }
}
fn fixture() -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("notes");
    let path = root.to_string_lossy().into_owned();
    operations::ensure_vault_structure(&path).unwrap();
    let config = AppConfig {
        active_vault: Some(path.clone()),
        vaults: vec![VaultConfig {
            path: path.clone(),
            name: "Work".into(),
            ..Default::default()
        }],
        ..Default::default()
    };
    let app = tauri::test::mock_builder()
        .manage(AppState::new(config))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
        .build()
        .unwrap();
    let profile = temp.path().join("profile");
    std::fs::create_dir(&profile).unwrap();
    let directory = profile.join("mcp");
    policy::secure_dir(&directory).unwrap();
    let core = Arc::new(Core {
        app: app.handle().clone(),
        directory,
        grants: Arc::new(RwLock::new(vec![])),
        listener: tokio::sync::Mutex::new(None),
        pending: Mutex::new(HashMap::new()),
        nonces: Mutex::new(vec![]),
        clock: (chrono::Utc::now().timestamp(), Instant::now()),
    });
    app.manage(McpRuntime {
        core: Ok(core.clone()),
    });
    Fixture {
        _temp: temp,
        app,
        core,
        vault: VaultRef {
            path,
            bookmark_id: None,
        },
    }
}
async fn connection(f: &Fixture, mode: Access) -> policy::Connection {
    f.core.configure(f.vault.clone(), mode).await.unwrap();
    let grants = f.core.grants.read().await;
    let grant = grants.iter().find(|grant| grant.vault == f.vault).unwrap();
    serde_json::from_slice(
        &policy::bounded_read(&f.core.connection_path(&grant.id), 8192, true).unwrap(),
    )
    .unwrap()
}
fn approve(f: &Fixture, accepted: bool) {
    let core = f.core.clone();
    f.app.listen("mcp-prepare", move |event| {
        let id = serde_json::from_str::<Value>(event.payload()).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        let mut pending = core.pending.lock().unwrap();
        if let Some(request) = pending.get_mut(&id) {
            request.replies = request.expected.clone();
            request.refused = !accepted;
            request.notify.notify_one();
        }
    });
}

#[tokio::test]
async fn access_is_off_by_default_and_read_grants_cannot_write() {
    let f = fixture();
    assert_eq!(f.core.status(&f.vault).await.unwrap()["mode"], "off");
    assert!(f.core.listener.lock().await.is_none());
    let connection = connection(&f, Access::Read).await;
    assert_eq!(
        bridge::call(&connection, "health", json!({}))
            .await
            .unwrap()["mode"],
        "read"
    );
    assert!(bridge::call(&connection, "edit_note", json!({}))
        .await
        .unwrap_err()
        .contains("Editing"));
    f.core
        .configure(f.vault.clone(), Access::Off)
        .await
        .unwrap();
    assert!(f.core.listener.lock().await.is_none());
    assert!(bridge::call(&connection, "health", json!({}))
        .await
        .is_err());
}

#[tokio::test]
async fn native_edits_preserve_identity_custom_metadata_and_conflict_history() {
    let f = fixture();
    approve(&f, true);
    let note = operations::create_note(&f.vault.path, None, "Example").unwrap();
    let mut raw = std::fs::read_to_string(&note.path).unwrap();
    raw = raw.replacen("---\n", "---\ncustom_owner: Ada\n", 1);
    raw.push_str("# Example\n\nOriginal text\n");
    std::fs::write(&note.path, &raw).unwrap();
    let before = operations::read_vault_note(&f.vault.path, &note.path).unwrap();
    let connection = connection(&f, Access::Write).await;
    let args = json!({"path":note.relative_path,"expectedRevision":policy::hash(raw.as_bytes()),"find":"Original text","replace":"Updated text","tags":["work"],"pinned":true});
    let result = bridge::call(&connection, "edit_note", args.clone())
        .await
        .unwrap();
    assert_eq!(result["applied"], true);
    let after = operations::read_vault_note(&f.vault.path, &note.path).unwrap();
    assert_eq!(after.meta.id, before.meta.id);
    assert_eq!(after.meta.created, before.meta.created);
    assert!(after.raw.contains("custom_owner: Ada"));
    assert!(after.content.contains("Updated text"));
    assert!(after.meta.pinned);
    assert!(
        !crate::history::list_versions(&f.vault.path, &after.meta.id)
            .unwrap()
            .is_empty()
    );
    assert!(bridge::call(&connection, "edit_note", args)
        .await
        .unwrap_err()
        .contains("conflict"));
}

#[tokio::test]
async fn a_dirty_or_unresponsive_editor_blocks_native_writes() {
    let f = fixture();
    approve(&f, false);
    let note = operations::create_note(&f.vault.path, None, "Example").unwrap();
    let raw = std::fs::read_to_string(&note.path).unwrap();
    let connection = connection(&f, Access::Write).await;
    let result=bridge::call(&connection,"edit_note",json!({"path":note.relative_path,"expectedRevision":policy::hash(raw.as_bytes()),"pinned":true})).await;
    assert!(result.unwrap_err().contains("unsaved"));
    assert_eq!(std::fs::read_to_string(&note.path).unwrap(), raw);
    assert!(f.core.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn forgetting_and_readding_the_same_folder_does_not_restore_access() {
    let f = fixture();
    let connection = connection(&f, Access::Read).await;
    {
        let state = f.app.state::<AppState>();
        let mut config = state.config.lock().unwrap();
        config.vaults[0].mcp_grant_id = None;
    }
    assert!(bridge::call(&connection, "list_notes", json!({}))
        .await
        .unwrap_err()
        .contains("forgotten"));
    assert_eq!(f.core.status(&f.vault).await.unwrap()["mode"], "off");
}

#[test]
fn credential_files_are_private_and_launchers_do_not_contain_secrets() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("mcp");
    policy::secure_dir(&directory).unwrap();
    let file = directory.join("connection.json");
    policy::private_write(&file, &json!({"secret":"not-for-the-clipboard"})).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    let config = policy::launcher(
        PathBuf::from("/app/bin/helixnotes"),
        None,
        Some("com.helixnotes.HelixNotes".into()),
        &file,
    );
    assert_eq!(config["mcpServers"]["helixnotes"]["command"], "flatpak");
    assert!(!config.to_string().contains("not-for-the-clipboard"));
}

#[tokio::test]
async fn permission_changes_rotate_keys_and_invalidate_old_connections() {
    let f = fixture();
    let old = connection(&f, Access::Read).await;
    let new = connection(&f, Access::Write).await;
    assert_eq!(old.id, new.id);
    assert_ne!(old.secret, new.secret);
    assert!(bridge::call(&old, "health", json!({})).await.is_err());
    assert_eq!(
        bridge::call(&new, "health", json!({})).await.unwrap()["mode"],
        "write"
    );
}

#[tokio::test]
async fn failed_permission_publication_rolls_back_without_authorizing_editing() {
    let f = fixture();
    let old = connection(&f, Access::Read).await;
    let file = f.core.directory.join("grants.json");
    std::fs::remove_file(&file).unwrap();
    std::fs::create_dir(&file).unwrap();
    assert!(f
        .core
        .configure(f.vault.clone(), Access::Write)
        .await
        .is_err());
    assert_eq!(f.core.status(&f.vault).await.unwrap()["mode"], "read");
    assert_eq!(
        bridge::call(&old, "health", json!({})).await.unwrap()["mode"],
        "read"
    );
    let restored: policy::Connection = serde_json::from_slice(
        &policy::bounded_read(&f.core.connection_path(&old.id), 8192, true).unwrap(),
    )
    .unwrap();
    assert_eq!(restored.secret, old.secret);
}

#[tokio::test]
async fn a_failed_connection_file_stage_leaves_access_off_and_stops_the_listener() {
    let f = fixture();
    std::fs::remove_dir(&f.core.directory).unwrap();
    std::fs::write(&f.core.directory, "blocked").unwrap();
    assert!(f
        .core
        .configure(f.vault.clone(), Access::Read)
        .await
        .is_err());
    assert!(f.core.grants.read().await.is_empty());
    assert!(f.core.listener.lock().await.is_none());
    assert!(f.app.state::<AppState>().config.lock().unwrap().vaults[0]
        .mcp_grant_id
        .is_none());
}

#[tokio::test]
async fn authorization_rejects_replays_modified_bodies_origins_and_wrong_hosts() {
    let f = fixture();
    let connection = connection(&f, Access::Read).await;
    let nonce = format!(
        "{}:{}:{}",
        connection.id,
        chrono::Utc::now().timestamp(),
        uuid::Uuid::new_v4().simple()
    );
    let body = serde_json::to_vec(&json!({"action":"health","args":{}})).unwrap();
    let auth = format!(
        "Helix {nonce}:{}",
        bridge::signature(&connection.secret, "request", &nonce, &body)
    );
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let send = || {
        client
            .post(&connection.endpoint)
            .header("Content-Type", "application/json")
            .header("Authorization", &auth)
            .body(body.clone())
    };
    assert_eq!(
        send()
            .header("Origin", "https://untrusted.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    assert_eq!(
        send()
            .header("Host", "untrusted.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    assert!(send().send().await.unwrap().status().is_success());
    assert_eq!(
        send().send().await.unwrap().status(),
        reqwest::StatusCode::TOO_MANY_REQUESTS
    );
    let changed = client
        .post(&connection.endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", &auth)
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(changed.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_unsigned_local_server_cannot_impersonate_helixnotes() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v1/mcp", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0u8; 8192];
        let _ = socket.read(&mut buffer).await;
        let body = r#"{"ok":true,"result":{"body":"forged content"}}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    let connection = policy::Connection {
        version: 1,
        mode: Access::Read,
        id: "a".repeat(32),
        secret: "b".repeat(64),
        endpoint,
    };
    assert!(bridge::call(&connection, "health", json!({}))
        .await
        .unwrap_err()
        .contains("unavailable"));
}

#[tokio::test]
async fn native_maintenance_is_rejected_without_freezing_windows() {
    let f = fixture();
    let connection = connection(&f, Access::Write).await;
    let note = operations::create_note(&f.vault.path, None, "Example").unwrap();
    let raw = std::fs::read_to_string(&note.path).unwrap();
    let state = f.app.state::<AppState>();
    let _maintenance = state.vault_maintenance.lock().await;
    let error=bridge::call(&connection,"edit_note",json!({"path":note.relative_path,"expectedRevision":policy::hash(raw.as_bytes()),"pinned":true})).await.unwrap_err();
    assert!(error.contains("maintenance"));
    assert!(f.core.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disconnected_callers_do_not_release_native_edits_or_allow_window_close() {
    let f = fixture();
    let connection = connection(&f, Access::Write).await;
    let note = operations::create_note(&f.vault.path, None, "Example").unwrap();
    let raw = std::fs::read_to_string(&note.path).unwrap();
    let relative = note.relative_path.clone();
    let request = tokio::spawn(async move {
        bridge::call(
            &connection,
            "edit_note",
            json!({"path":relative,"expectedRevision":policy::hash(raw.as_bytes()),"pinned":true}),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(3), async {
        while f.core.pending.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    request.abort();
    let _ = request.await;
    assert!(McpRuntime::editing(f.app.handle()));
    assert!(crate::commands::complete_window_close(
        f.app.get_webview_window("main").unwrap().as_ref().window(),
        f.app.state()
    )
    .unwrap_err()
    .contains("MCP"));
    {
        let mut pending = f.core.pending.lock().unwrap();
        for request in pending.values_mut() {
            request.replies = request.expected.clone();
            request.notify.notify_one();
        }
    }
    tokio::time::timeout(Duration::from_secs(3), async {
        while McpRuntime::editing(f.app.handle()) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert!(
        operations::read_vault_note(&f.vault.path, &note.path)
            .unwrap()
            .meta
            .pinned
    );
}

#[tokio::test]
async fn unresponsive_windows_time_out_and_authoritative_recovery_reports_completion() {
    let f = fixture();
    let core = f.core.clone();
    let request =
        tokio::spawn(async move { core.freeze("/vault", "/vault/note.md").await.map(|_| ()) });
    tokio::time::timeout(Duration::from_secs(2), async {
        while f.core.pending.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let window = f.app.get_webview_window("main").unwrap();
    let active = mcp_active_request(window.clone(), f.app.state())
        .unwrap()
        .unwrap();
    assert_eq!(active.path, "/vault/note.md");
    assert!(mcp_request_state(window.clone(), f.app.state(), active.id.clone()).unwrap());
    assert!(request
        .await
        .unwrap()
        .unwrap_err()
        .contains("did not respond"));
    assert!(!mcp_request_state(window, f.app.state(), active.id).unwrap());
}

#[test]
fn inspection_is_bounded_preserves_numeric_ids_and_never_invents_dates() {
    let result = notes::inspect(
        "---\nid: 9876543210123456789\ntags: work, home\npinned: yes\ncustom: keep\n---\nbody",
        "my-note.md",
    );
    assert_eq!(result["known"]["id"], "9876543210123456789");
    assert_eq!(result["known"]["created"], Value::Null);
    assert_eq!(result["known"]["pinned"], true);
    assert_eq!(result["unknownKeys"], json!(["custom"]));
    for yaml in [
        "x: &0 [1]\ny: *0".to_string(),
        "x: &я [1]\ny: *я".into(),
        format!("x: {}0", "- ".repeat(40)),
        format!("x: {}", "a".repeat(65536)),
        "id: a\nid: b".into(),
        "__proto__: !<tag:custom> unsafe".into(),
    ] {
        assert!(notes::parse_mapping(&yaml).is_err(), "{yaml:.80}");
    }
    assert!(notes::parse_mapping("__proto__:\n  id: injected\nid: real").is_ok());
}

#[tokio::test]
async fn scope_checks_and_unicode_body_pages_do_not_expose_or_corrupt_data() {
    let f = fixture();
    let _ = connection(&f, Access::Read).await;
    let grant = f.core.grants.read().await[0].clone();
    let body = "# Example\n\n日本語 😀 and text\n";
    std::fs::write(grant.root.join("unicode.md"), body).unwrap();
    let mut offset = 0;
    let mut restored = String::new();
    loop {
        let part = notes::read(
            &grant,
            &json!({"path":"unicode.md","bodyOffset":offset,"maxChars":2}),
        )
        .unwrap();
        restored.push_str(part["body"].as_str().unwrap());
        let Some(next) = part["nextBodyOffset"].as_u64() else {
            break;
        };
        offset = next;
    }
    assert_eq!(restored, body);
    for path in [
        "../outside.md",
        ".helixnotes/config.json",
        "assets/a.md",
        "/etc/passwd",
        "C:note.md",
        "Book\\note.md",
    ] {
        assert!(notes::resolve(&grant, path, false).is_err());
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/etc/passwd", grant.root.join("link.md")).unwrap();
        assert!(notes::resolve(&grant, "link.md", false).is_err());
    }
}

#[tokio::test]
async fn general_edits_refuse_secret_body_changes_and_legacy_metadata() {
    let f = fixture();
    let _ = connection(&f, Access::Write).await;
    let grant = f.core.grants.read().await[0].clone();
    let note = operations::create_note(&f.vault.path, None, "Example").unwrap();
    let mut raw = std::fs::read_to_string(&note.path).unwrap();
    raw.push_str("# Example\n\n~~~helix-secret\nopaque\n~~~\n");
    std::fs::write(&note.path, &raw).unwrap();
    let edit:notes::Edit=serde_json::from_value(json!({"path":note.relative_path,"expectedRevision":policy::hash(raw.as_bytes()),"find":"opaque","replace":"changed"})).unwrap();
    assert!(notes::prepare_edit(&grant, &edit)
        .unwrap_err()
        .contains("encrypted"));
    let legacy = "---\ntitle: Legacy\n---\nbody";
    std::fs::write(grant.root.join("legacy.md"), legacy).unwrap();
    let edit:notes::Edit=serde_json::from_value(json!({"path":"legacy.md","expectedRevision":policy::hash(legacy.as_bytes()),"pinned":true})).unwrap();
    assert!(notes::prepare_edit(&grant, &edit)
        .unwrap_err()
        .contains("metadata"));
}

#[tokio::test]
async fn inactive_unavailable_vault_access_can_be_revoked_without_recreating_storage() {
    let f = fixture();
    let _ = connection(&f, Access::Write).await;
    {
        let state = f.app.state::<AppState>();
        let mut config = state.config.lock().unwrap();
        config.active_vault = Some("/other-active-vault".into());
    }
    std::fs::remove_dir_all(&f.vault.path).unwrap();
    let status = f.core.status(&f.vault).await.unwrap();
    assert_eq!(status["mode"], "write");
    assert_eq!(status["ready"], false);
    assert!(status["error"].is_string());
    f.core
        .configure(f.vault.clone(), Access::Off)
        .await
        .unwrap();
    assert_eq!(f.core.status(&f.vault).await.unwrap()["mode"], "off");
    assert!(!std::path::Path::new(&f.vault.path).exists());
}

#[test]
fn corrupt_optional_binding_revokes_access_without_dropping_the_saved_vault() {
    let config: AppConfig = serde_json::from_value(
        json!({"vaults":[{"path":"/notes/Work","name":"Work","mcp_grant_id":42}]}),
    )
    .unwrap();
    assert_eq!(config.vaults.len(), 1);
    assert!(config.vaults[0].mcp_grant_id.is_none());
}

#[tokio::test]
#[ignore = "Run pnpm test:mcp:native to build the packaged executable and test it with the official TypeScript client."]
async fn packaged_helper_stdio_roundtrip() {
    let f = fixture();
    approve(&f, true);
    let note = operations::create_note(&f.vault.path, None, "Example").unwrap();
    let mut raw = std::fs::read_to_string(&note.path).unwrap();
    raw = raw.replacen("---\n", "---\ncustom_owner: Ada\n", 1);
    raw.push_str("# Example\n\nOriginal text 😀\n");
    std::fs::write(&note.path, &raw).unwrap();
    let connection = connection(&f, Access::Write).await;
    let binary = std::env::var_os("HELIX_MCP_HELPER_BIN").expect("Use pnpm test:mcp:native");
    let client = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("packages/mcp/tests/native-client.mjs");
    let output = tokio::time::timeout(
        Duration::from_secs(45),
        tokio::process::Command::new("node")
            .arg(client)
            .arg(binary)
            .arg(f.core.connection_path(&connection.id))
            .arg(&note.relative_path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    println!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(operations::read_vault_note(&f.vault.path, &note.path)
        .unwrap()
        .content
        .contains("Updated through the packaged helper"));
}
