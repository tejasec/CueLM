//! Opt-in, per-vault MCP access. The packaged stdio helper uses a private authenticated
//! loopback bridge; it never writes vault files independently of the running app.
mod bridge;
mod knowledge;
mod notes;
mod policy;
mod stdio;
#[cfg(test)]
mod tests;

use policy::{Access, Grant, VaultRef};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio::sync::{Notify, RwLock};
use uuid::Uuid;

pub struct McpRuntime<R: tauri::Runtime = tauri::Wry> {
    core: Result<Arc<Core<R>>, String>,
}
pub(super) struct Core<R: tauri::Runtime = tauri::Wry> {
    app: tauri::AppHandle<R>,
    directory: PathBuf,
    grants: Arc<RwLock<Vec<Grant>>>,
    listener: tokio::sync::Mutex<Option<bridge::Listener>>,
    pending: Mutex<HashMap<String, Pending>>,
    nonces: Mutex<Vec<(String, Instant)>>,
    clock: (i64, Instant),
}
struct Pending {
    expected: HashSet<String>,
    replies: HashSet<String>,
    refused: bool,
    notify: Arc<Notify>,
    target: Finish,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finish {
    id: String,
    vault_path: String,
    path: String,
}
struct Frozen<R: tauri::Runtime> {
    core: Arc<Core<R>>,
    finish: Finish,
}
impl<R: tauri::Runtime> Drop for Frozen<R> {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.core.pending.lock() {
            pending.remove(&self.finish.id);
        }
        let _ = self.core.app.emit("mcp-finish", &self.finish);
    }
}

impl<R: tauri::Runtime> McpRuntime<R> {
    pub fn install(app: &tauri::AppHandle<R>) {
        let core = (|| {
            let directory = crate::commands::app_config_path()?
                .parent()
                .ok_or("Config directory is unavailable.")?
                .join("mcp");
            policy::secure_dir(&directory)?;
            let file = directory.join("grants.json");
            let mut grants: Vec<Grant> = if file.exists() {
                serde_json::from_slice(&policy::bounded_read(&file,1024*1024,true)?).map_err(|_| "MCP permission file is invalid. Repair it or remove it to revoke all grants.")?
            } else {
                vec![]
            };
            if grants.len() > 128 {
                return Err("Too many MCP grants.".into());
            }
            let mut ids = HashSet::new();
            let config = app.state::<crate::state::AppState>();
            let config = config.config.lock().map_err(|_| "Config is unavailable.")?;
            for grant in &mut grants {
                if grant.id.len() != 32
                    || Uuid::parse_str(&grant.id).is_err()
                    || !ids.insert(grant.id.clone())
                    || !grant.root.is_absolute()
                    || (grant.mode != Access::Off && grant.marker.len() != 64)
                {
                    return Err("MCP permission file is invalid.".into());
                }
                // Re-key every app launch. A stale local port must not retain usable credentials.
                if grant.mode != Access::Off
                    && config.vaults.iter().any(|vault| {
                        vault.path == grant.vault.path
                            && vault.bookmark_id == grant.vault.bookmark_id
                            && vault.mcp_grant_id.as_deref() == Some(grant.id.as_str())
                    })
                {
                    grant.secret = policy::new_secret();
                } else {
                    grant.mode = Access::Off;
                    grant.secret.clear();
                }
            }
            if file.exists() {
                policy::private_write(&file, &grants)?;
            }
            Ok(Arc::new(Core {
                app: app.clone(),
                directory,
                grants: Arc::new(RwLock::new(grants)),
                listener: tokio::sync::Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                nonces: Mutex::new(vec![]),
                clock: (chrono::Utc::now().timestamp(), Instant::now()),
            }))
        })();
        if let Ok(core) = &core {
            let core = core.clone();
            tauri::async_runtime::spawn(async move {
                let grants = core.grants.read().await;
                if grants.iter().any(|grant| grant.mode != Access::Off) {
                    if let Err(error) = core.ensure_listener(&grants).await {
                        log::error!("MCP could not start: {error}");
                    }
                }
            });
        } else {
            log::error!("MCP is unavailable: {}", core.as_ref().err().unwrap());
        }
        app.manage(Self { core });
    }
    fn core(&self) -> Result<Arc<Core<R>>, String> {
        self.core.clone()
    }
    pub(crate) fn editing(app: &tauri::AppHandle<R>) -> bool {
        app.try_state::<Self>()
            .and_then(|runtime| runtime.core().ok())
            .is_some_and(|core| {
                core.pending
                    .lock()
                    .map(|pending| !pending.is_empty())
                    .unwrap_or(true)
            })
    }
}

impl<R: tauri::Runtime> Core<R> {
    fn connection_path(&self, id: &str) -> PathBuf {
        self.directory.join(format!("{id}.json"))
    }
    async fn ensure_listener(self: &Arc<Self>, grants: &[Grant]) -> Result<String, String> {
        let mut listener = self.listener.lock().await;
        if let Some(listener) = listener.as_ref() {
            return Ok(listener.endpoint.clone());
        }
        let new = bridge::start(self.clone()).await?;
        for grant in grants {
            if grant.mode != Access::Off {
                policy::private_write(
                    &self.connection_path(&grant.id),
                    &grant.connection(&new.endpoint),
                )?;
            }
        }
        let endpoint = new.endpoint.clone();
        *listener = Some(new);
        Ok(endpoint)
    }
    fn current(&self, vault: &VaultRef) -> Result<Option<String>, String> {
        let state = self.app.state::<crate::state::AppState>();
        let config = state.config.lock().map_err(|_| "Config is unavailable.")?;
        config
            .vaults
            .iter()
            .find(|entry| entry.path == vault.path && entry.bookmark_id == vault.bookmark_id)
            .map(|entry| entry.mcp_grant_id.clone())
            .ok_or_else(|| "This vault is not registered.".into())
    }
    async fn status(self: &Arc<Self>, vault: &VaultRef) -> Result<Value, String> {
        let grants = self.grants.read().await;
        let binding = self.current(vault)?;
        let grant = grants
            .iter()
            .find(|grant| grant.vault == *vault && Some(&grant.id) == binding.as_ref());
        let mode = grant.map_or(Access::Off, |grant| grant.mode);
        let mut error = None;
        let ready = if let Some(grant) = grant.filter(|grant| grant.mode != Access::Off) {
            let state = self.app.state::<crate::state::AppState>();
            let valid = match state.config.lock() {
                Ok(config) => grant.validate(&config),
                Err(_) => Err("Config is unavailable.".into()),
            };
            let result = match valid {
                Ok(()) => self.ensure_listener(&grants).await.map(|_| ()),
                Err(error) => Err(error),
            };
            match result {
                Ok(()) => true,
                Err(message) => {
                    error = Some(message);
                    false
                }
            }
        } else {
            false
        };
        // Keep the saved permission visible even if storage/the helper file is
        // unavailable, so the user can still revoke it without reconnecting storage.
        Ok(json!({"mode":mode,"ready":ready,"error":error}))
    }
    async fn configure(self: &Arc<Self>, vault: VaultRef, mode: Access) -> Result<Value, String> {
        let mut grants = self.grants.write().await;
        let state = self.app.state::<crate::state::AppState>();
        let _transition = state.vault_transition.lock().await;
        let binding = self.current(&vault)?;
        let old = grants
            .iter()
            .find(|grant| grant.vault == vault && Some(&grant.id) == binding.as_ref())
            .cloned();
        let id = old
            .as_ref()
            .map(|grant| grant.id.clone())
            .or(binding)
            .unwrap_or_else(|| Uuid::new_v4().simple().to_string());
        let root = if mode == Access::Off {
            old.as_ref()
                .map(|grant| grant.root.clone())
                .unwrap_or_else(|| PathBuf::from(&vault.path))
        } else {
            std::fs::canonicalize(&vault.path).map_err(|_| "Vault is unavailable.")?
        };
        let marker = if mode == Access::Off {
            old.as_ref()
                .map(|grant| grant.marker.clone())
                .unwrap_or_default()
        } else {
            policy::marker(&root)?
        };
        let grant = Grant {
            id: id.clone(),
            vault: vault.clone(),
            root,
            marker,
            mode,
            secret: if mode == Access::Off {
                String::new()
            } else {
                policy::new_secret()
            },
        };
        let mut next = grants.clone();
        next.retain(|entry| entry.vault != vault);
        next.push(grant.clone());
        if next.len() > 128 {
            return Err("Too many MCP grants. Revoke unused vault access first.".into());
        }
        let endpoint = if mode != Access::Off {
            self.ensure_listener(&grants).await?
        } else {
            String::new()
        };
        // Stage the helper file before publishing authorization. A staged new key is
        // unusable until both the policy and saved-vault binding have committed.
        if let Err(error) =
            policy::private_write(&self.connection_path(&id), &grant.connection(&endpoint))
        {
            if !grants.iter().any(|grant| grant.mode != Access::Off) {
                self.listener.lock().await.take();
            }
            return Err(error);
        }
        let committed = (|| {
            let mut config = state.config.lock().map_err(|_| "Config is unavailable.")?;
            let mut updated = config.clone();
            let entry = updated
                .vaults
                .iter_mut()
                .find(|entry| entry.path == vault.path && entry.bookmark_id == vault.bookmark_id)
                .ok_or("Vault changed.")?;
            entry.mcp_grant_id = Some(id.clone());
            let path = self
                .directory
                .parent()
                .ok_or("Config directory is unavailable.")?
                .join("config.json");
            crate::commands::save_app_config_to(&updated, &path)?;
            if let Err(error) = policy::private_write(&self.directory.join("grants.json"), &next) {
                if crate::commands::save_app_config_to(&config, &path).is_err() {
                    log::error!(
                        "Could not roll back MCP's vault binding; no new permission was published."
                    );
                }
                return Err(error);
            }
            *config = updated;
            Ok::<_, String>(())
        })();
        if let Err(error) = committed {
            let old_endpoint = self
                .listener
                .lock()
                .await
                .as_ref()
                .map(|listener| listener.endpoint.clone())
                .unwrap_or_default();
            let previous = old
                .as_ref()
                .map(|old| old.connection(&old_endpoint))
                .unwrap_or_else(|| {
                    let mut disabled = grant.connection("");
                    disabled.mode = Access::Off;
                    disabled.secret.clear();
                    disabled
                });
            if policy::private_write(&self.connection_path(&id), &previous).is_err() {
                log::error!("Could not restore an inactive MCP helper file; authorization was not expanded.");
            }
            if !grants.iter().any(|grant| grant.mode != Access::Off) {
                self.listener.lock().await.take();
            }
            return Err(error);
        }
        *grants = next;
        if mode == Access::Off && !grants.iter().any(|grant| grant.mode != Access::Off) {
            self.listener.lock().await.take();
        }
        Ok(json!({"mode":mode,"ready":mode!=Access::Off}))
    }
    fn labels(&self) -> HashSet<String> {
        self.app.webview_windows().into_keys().collect()
    }
    async fn freeze(self: &Arc<Self>, vault: &str, path: &str) -> Result<Frozen<R>, String> {
        let id = Uuid::new_v4().simple().to_string();
        let notify = Arc::new(Notify::new());
        let expected = self.labels();
        if expected.is_empty() {
            return Err("No application window can authorize this edit.".into());
        }
        self.pending
            .lock()
            .map_err(|_| "Editor gate is unavailable.")?
            .insert(
                id.clone(),
                Pending {
                    expected,
                    replies: HashSet::new(),
                    refused: false,
                    notify: notify.clone(),
                    target: Finish {
                        id: id.clone(),
                        vault_path: vault.into(),
                        path: path.into(),
                    },
                },
            );
        let frozen = Frozen {
            core: self.clone(),
            finish: Finish {
                id: id.clone(),
                vault_path: vault.into(),
                path: path.into(),
            },
        };
        self.app
            .emit("mcp-prepare", &frozen.finish)
            .map_err(|_| "Could not contact application editors.")?;
        tokio::time::timeout(Duration::from_secs(8),async{
            loop {
                let wait=notify.notified();
                {let pending=self.pending.lock().map_err(|_|"Editor gate is unavailable.")?;let request=pending.get(&id).ok_or("Editor request expired.")?;
                    if request.refused{return Err("An editor has unsaved changes, an active composition or another operation. Save your notes and retry.".to_string());}
                    if request.replies==request.expected{return Ok(());}}
                wait.await;
            }
        }).await.map_err(|_|"An editor did not respond. Reopen HelixNotes and retry.")??;
        Ok(frozen)
    }
    async fn edit(
        self: Arc<Self>,
        id: String,
        generation: String,
        edit: notes::Edit,
    ) -> Result<Value, String> {
        // This task is detached from the HTTP socket: disconnect/cancellation must not
        // release editors while a blocking disk commit is still running.
        let grants = self.grants.clone().read_owned().await;
        let grant = grants
            .iter()
            .find(|grant| {
                grant.id == id && grant.mode == Access::Write && grant.secret == generation
            })
            .cloned()
            .ok_or("Editing is not allowed for this connection.")?;
        let state = self.app.state::<crate::state::AppState>();
        let _transition = state
            .vault_transition
            .try_lock()
            .map_err(|_| "The vault is switching. Retry when it is ready.")?;
        let _maintenance = state
            .vault_maintenance
            .try_lock()
            .map_err(|_| "The vault is syncing or running maintenance. Retry when it finishes.")?;
        {
            let config = state.config.lock().map_err(|_| "Config is unavailable.")?;
            grant.validate(&config)?;
        }
        notes::resolve(&grant, &edit.path, false)?;
        let logical = notes::logical_path(&grant, &edit.path);
        let _frozen = self
            .freeze(&grant.vault.path, &logical.to_string_lossy())
            .await?;
        if self.labels()
            != self
                .pending
                .lock()
                .map_err(|_| "Editor gate is unavailable.")?
                .get(&_frozen.finish.id)
                .ok_or("Editor request expired.")?
                .expected
        {
            return Err("Application windows changed. Retry the edit.".into());
        }
        let save = state
            .note_save
            .clone()
            .try_lock_owned()
            .map_err(|_| "Another native note operation is running. Retry when it finishes.")?;
        let search = state.vault_snapshot(&grant.vault.path)?;
        let max_versions = state
            .config
            .lock()
            .map_err(|_| "Config is unavailable.")?
            .max_versions_per_note;
        let app = self.app.clone();
        let result=tauri::async_runtime::spawn_blocking(move||{
            let _save=save;
            let (path,meta,body,raw)=notes::prepare_edit(&grant,&edit)?;
            {let state=app.state::<crate::state::AppState>();let config=state.config.lock().map_err(|_|"Config is unavailable.")?;grant.validate(&config)?;}
            // Commit against the pinned canonical root. Index/report using the
            // app's logical path (not Windows' extended canonical-path prefix).
            let changed=crate::commands::commit_note(None,&grant.root.to_string_lossy(),&path,&meta,&body,&raw,max_versions)?;
            if changed{
                crate::commands::index_note_bg(search,&logical.to_string_lossy());
                let event=crate::vault::watcher::changed_entry(logical,"modify",std::path::Path::new(&grant.vault.path));
                let _=app.emit("file-changed",event);
            }
            // A failed readback must not misreport an already committed write as failed.
            let revision=notes::read_raw(&grant,&edit.path).ok().map(|raw|policy::hash(raw.as_bytes()));
            Ok::<_,String>(json!({"applied":true,"changed":changed,"path":edit.path,"revision":revision,"rereadRequired":true}))
        }).await.map_err(|_|"Native edit worker failed.")?;
        drop(grants);
        result
    }
}

fn main_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    if window.label() != "main" {
        Err("Configure MCP from the main HelixNotes window.".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn mcp_status<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    runtime: tauri::State<'_, McpRuntime<R>>,
    vault: VaultRef,
) -> Result<Value, String> {
    main_window(&window)?;
    runtime.core()?.status(&vault).await
}
#[tauri::command]
pub async fn mcp_set_access<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    runtime: tauri::State<'_, McpRuntime<R>>,
    vault: VaultRef,
    mode: Access,
) -> Result<Value, String> {
    main_window(&window)?;
    runtime.core()?.configure(vault, mode).await
}
#[tauri::command]
pub async fn mcp_client_config<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    runtime: tauri::State<'_, McpRuntime<R>>,
    vault: VaultRef,
) -> Result<Value, String> {
    main_window(&window)?;
    let core = runtime.core()?;
    let status = core.status(&vault).await?;
    if status["ready"] != true {
        return Err(status["error"]
            .as_str()
            .unwrap_or("Enable MCP access first.")
            .into());
    }
    let grants = core.grants.read().await;
    let binding = core.current(&vault)?;
    let grant = grants
        .iter()
        .find(|grant| Some(&grant.id) == binding.as_ref() && grant.mode != Access::Off)
        .ok_or("Enable MCP access first.")?;
    Ok(policy::launcher(
        std::env::current_exe().map_err(|_| "Application executable is unavailable.")?,
        std::env::var_os("APPIMAGE").map(PathBuf::from),
        std::env::var("FLATPAK_ID").ok(),
        &core.connection_path(&grant.id),
    ))
}
#[tauri::command]
pub fn mcp_editor_ready<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    runtime: tauri::State<'_, McpRuntime<R>>,
    id: String,
    accepted: bool,
) -> Result<(), String> {
    let core = runtime.core()?;
    let mut pending = core
        .pending
        .lock()
        .map_err(|_| "Editor gate is unavailable.")?;
    if let Some(request) = pending.get_mut(&id) {
        let label = window.label();
        if request.expected.contains(label) && request.replies.insert(label.into()) {
            request.refused |= !accepted;
            request.notify.notify_one();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_request_state<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    runtime: tauri::State<'_, McpRuntime<R>>,
    id: String,
) -> Result<bool, String> {
    let core = runtime.core()?;
    let pending = core
        .pending
        .lock()
        .map_err(|_| "Editor gate is unavailable.")?;
    Ok(pending
        .get(&id)
        .is_some_and(|request| request.expected.contains(window.label())))
}

#[tauri::command]
pub fn mcp_active_request<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    runtime: tauri::State<'_, McpRuntime<R>>,
) -> Result<Option<Finish>, String> {
    let Ok(core) = runtime.core() else {
        return Ok(None);
    };
    let pending = core
        .pending
        .lock()
        .map_err(|_| "Editor gate is unavailable.")?;
    Ok(pending
        .values()
        .find(|request| request.expected.contains(window.label()))
        .map(|request| request.target.clone()))
}

/// Called before Tauri/WebKit/single-instance initialization. The installed app is its helper.
pub fn run_cli_if_requested() -> bool {
    stdio::run_cli_if_requested()
}
