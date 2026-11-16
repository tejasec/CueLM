use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    #[default]
    Off,
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultRef {
    pub path: String,
    pub bookmark_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub id: String,
    pub vault: VaultRef,
    pub root: PathBuf,
    pub marker: String,
    pub mode: Access,
    pub secret: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connection {
    pub version: u8,
    pub mode: Access,
    pub id: String,
    pub endpoint: String,
    pub secret: String,
}

pub fn new_secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn bounded_read(path: &Path, max: usize, private: bool) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "File is unavailable.")?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("A regular file is required.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if private {
            let parent = fs::symlink_metadata(path.parent().ok_or("Invalid credential path.")?)
                .map_err(|_| "MCP credential directory is unavailable.")?;
            let uid = unsafe { libc::geteuid() };
            if meta.permissions().mode() & 0o077 != 0
                || meta.uid() != uid
                || parent.permissions().mode() & 0o077 != 0
                || parent.uid() != uid
                || !parent.is_dir()
                || parent.file_type().is_symlink()
            {
                return Err("MCP credentials must belong to your user and be private (file 0600, directory 0700).".into());
            }
        }
    }
    #[cfg(not(unix))]
    let _ = private;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "File could not be opened.")?;
    let opened = file.metadata().map_err(|_| "File is unavailable.")?;
    if !opened.is_file() {
        return Err("A regular file is required.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if private
            && (opened.permissions().mode() & 0o077 != 0
                || opened.uid() != unsafe { libc::geteuid() })
        {
            return Err("MCP credentials are not private to your user.".into());
        }
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((max + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "File could not be read.")?;
    if bytes.len() > max {
        return Err("File exceeds the MCP size limit.".into());
    }
    Ok(bytes)
}

pub fn secure_dir(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
            return Err("MCP credential directory must not be a symlink or file.".into())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|_| "Could not create MCP credential directory.")?;
        }
        Err(_) => return Err("MCP credential directory is unavailable.".into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not protect MCP credentials.")?;
    }
    #[cfg(windows)]
    protect_windows(path, true)?;
    Ok(())
}

pub fn private_write(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid credential path.")?;
    secure_dir(parent)?;
    if fs::symlink_metadata(path).is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
    {
        return Err("MCP credential file must not be a symlink or directory.".into());
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not stage MCP credentials.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "Could not protect MCP credentials.")?;
    }
    #[cfg(windows)]
    protect_windows(temporary.path(), false)?;
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|_| "Could not serialize MCP configuration.")?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "Could not save MCP credentials.")?;
    temporary
        .persist(path)
        .map_err(|_| "Could not publish MCP credentials.")?;
    #[cfg(unix)]
    if fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .is_err()
    {
        // The rename already committed: do not report a false failure that would
        // leave in-memory authorization disagreeing with the persisted policy.
        log::warn!("MCP credential directory synchronization is unavailable.");
    }
    Ok(())
}

#[cfg(windows)]
fn protect_windows(path: &Path, directory: bool) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW,
                SE_FILE_OBJECT,
            },
            GetSecurityDescriptorDacl, DACL_SECURITY_INFORMATION,
            PROTECTED_DACL_SECURITY_INFORMATION,
        },
    };
    let mut name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let sddl: Vec<u16> = if directory {
        "D:P(A;OICI;FA;;;OW)"
    } else {
        "D:P(A;;FA;;;OW)"
    }
    .encode_utf16()
    .chain(Some(0))
    .collect();
    let mut descriptor = ptr::null_mut();
    // OWNER RIGHTS grants only the file owner; protected DACLs do not inherit broad permissions.
    unsafe {
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            ptr::null_mut(),
        ) == 0
        {
            return Err("Could not protect MCP credentials.".into());
        }
        let mut present = 0;
        let mut defaulted = 0;
        let mut acl = ptr::null_mut();
        let ok = GetSecurityDescriptorDacl(descriptor, &mut present, &mut acl, &mut defaulted) != 0
            && present != 0
            && SetNamedSecurityInfoW(
                name.as_mut_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                acl,
                ptr::null_mut(),
            ) == 0;
        LocalFree(descriptor);
        if !ok {
            return Err("Could not protect MCP credentials.".into());
        }
    }
    Ok(())
}

pub fn marker(root: &Path) -> Result<String, String> {
    let private = fs::symlink_metadata(root.join(".helixnotes"))
        .map_err(|_| "Reconnect this vault's storage before enabling MCP.")?;
    if !private.is_dir() || private.file_type().is_symlink() {
        return Err("Vault metadata must be a regular directory.".into());
    }
    bounded_read(&root.join(".helixnotes/config.json"), 64 * 1024, false).map(|bytes| hash(&bytes))
}

impl Grant {
    pub fn validate(&self, config: &crate::types::AppConfig) -> Result<(), String> {
        if self.mode == Access::Off
            || !config.vaults.iter().any(|vault| {
                vault.path == self.vault.path
                    && vault.bookmark_id == self.vault.bookmark_id
                    && vault.mcp_grant_id.as_deref() == Some(self.id.as_str())
            })
        {
            return Err("MCP access to this vault is disabled or the vault was forgotten.".into());
        }
        if fs::canonicalize(&self.vault.path).map_err(|_| "Vault is unavailable.")? != self.root
            || marker(&self.root)? != self.marker
        {
            return Err(
                "The vault or its metadata changed. Disable and re-enable MCP access in Settings."
                    .into(),
            );
        }
        Ok(())
    }
    pub fn connection(&self, endpoint: &str) -> Connection {
        Connection {
            version: 1,
            mode: self.mode,
            id: self.id.clone(),
            endpoint: endpoint.into(),
            secret: self.secret.clone(),
        }
    }
}

pub fn launcher(
    executable: PathBuf,
    appimage: Option<PathBuf>,
    flatpak: Option<String>,
    connection: &Path,
) -> serde_json::Value {
    let (command, mut args) = if let Some(id) = flatpak.filter(|id| {
        id == "com.cuelm.app" || id == "com.helixnotes.HelixNotes" || id == "com.helixnotes.app"
    }) {
        let cmd = if id == "com.cuelm.app" {
            "--command=cuelm"
        } else {
            "--command=helixnotes"
        };
        ("flatpak".into(), vec!["run".to_string(), cmd.into(), id])
    } else {
        (
            appimage
                .filter(|path| path.is_absolute() && path.is_file())
                .unwrap_or(executable)
                .to_string_lossy()
                .into_owned(),
            vec![],
        )
    };
    args.extend([
        "--mcp-stdio".into(),
        "--connection".into(),
        connection.to_string_lossy().into_owned(),
    ]);
    serde_json::json!({
        "mcpServers": {
            "cuelm": { "command": command.clone(), "args": args.clone() },
            "helixnotes": { "command": command, "args": args }
        }
    })
}
