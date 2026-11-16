//! A vault-owned Markdown template, deliberately outside the note/task/search tree.
use std::fs;
use std::io::Read;
use std::path::PathBuf;

pub const RELATIVE_PATH: &str = ".helixnotes/daily-template.md";
pub const MAX_BYTES: usize = 256 * 1024;
const DISABLED_HEADER: &str = "---\nhelixnotes_daily_template_enabled: false\n---\n";

#[derive(Debug, serde::Serialize)]
pub struct DailyTemplate {
    /// The exact stored bytes, used as a compare-and-swap revision.
    pub raw: Option<String>,
    pub content: String,
    pub enabled: bool,
}

impl DailyTemplate {
    pub fn from_raw(raw: Option<String>) -> Self {
        let enabled = raw.as_deref().is_some_and(is_enabled);
        let content = raw.as_deref().map(body).unwrap_or_default().to_string();
        Self {
            raw,
            content,
            enabled,
        }
    }
}

pub fn is_enabled(raw: &str) -> bool {
    let parsed = gray_matter::Matter::<super::frontmatter::BoundedYaml>::new()
        .parse(raw.strip_prefix('\u{feff}').unwrap_or(raw));
    parsed
        .data
        .and_then(|data| data.deserialize::<serde_json::Value>().ok())
        .and_then(|data| {
            data.get("helixnotes_daily_template_enabled")
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(true)
}

fn path(vault: &str, create_parent: bool) -> Result<Option<PathBuf>, String> {
    let root = fs::canonicalize(vault).map_err(|e| format!("Invalid vault: {e}"))?;
    if !root.is_dir() {
        return Err("Vault is not a directory".into());
    }
    let parent = root.join(".helixnotes");
    if create_parent {
        match fs::create_dir(&parent) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    match fs::symlink_metadata(&parent) {
        Ok(meta) if meta.file_type().is_dir() => {}
        Ok(_) => return Err("Vault metadata directory must not be a symlink or file".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    }
    let target = root.join(RELATIVE_PATH);
    match fs::symlink_metadata(&target) {
        Ok(meta) if !meta.file_type().is_file() => {
            return Err("Daily template must be a regular file, not a symlink".into())
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
        _ => {}
    }
    Ok(Some(target))
}

/// Bound the read itself, including Android document-provider streams and growing files.
pub fn read_from(reader: impl Read) -> Result<String, String> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Daily template exceeds the 256 KiB limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "Daily template must be UTF-8 text".into())
}

pub fn read(vault: &str) -> Result<Option<String>, String> {
    let Some(target) = path(vault, false)? else {
        return Ok(None);
    };
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    match options.open(target) {
        Ok(file) => read_from(file).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read daily template: {e}")),
    }
}

/// Ignore a leading UTF-8 BOM and complete YAML frontmatter, without trimming the body.
/// An unmatched Markdown horizontal rule is ordinary body text, not metadata.
pub fn body(raw: &str) -> &str {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut lines = raw.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return raw;
    };
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return raw;
    }
    let mut offset = first.len();
    for line in lines {
        offset += line.len();
        if matches!(line.trim_end_matches(['\r', '\n']), "---" | "...") {
            return &raw[offset..];
        }
    }
    raw
}

/// Compare-and-swap prevents a stale Settings window from replacing another window's edit.
pub fn set(
    vault: &str,
    template: Option<&str>,
    expected: Option<&str>,
) -> Result<Option<String>, String> {
    if template.is_some_and(|text| text.len() > MAX_BYTES - DISABLED_HEADER.len()) {
        return Err("Daily template exceeds the 256 KiB limit".into());
    }
    let current = read(vault)?;
    if current.as_deref() != expected {
        return Err(
            "Daily template changed on disk. Reload it before saving; your draft was not written."
                .into(),
        );
    }
    let Some(target) = path(vault, template.is_some())? else {
        return Ok(None);
    };
    if let Some(raw) = template {
        let text = body(raw);
        super::operations::replace_file_atomically(&target, text.as_bytes())?;
        Ok(Some(text.to_string()))
    } else if let Some(raw) = current {
        // Disabling must not destroy the only copy of a template created in Settings.
        let disabled = format!("{DISABLED_HEADER}{}", body(&raw));
        if disabled.len() > MAX_BYTES {
            return Err("Daily template exceeds the 256 KiB limit".into());
        }
        super::operations::replace_file_atomically(&target, disabled.as_bytes())?;
        Ok(Some(disabled))
    } else {
        Ok(None)
    }
}

pub fn expand(raw: &str, date: &str, title: &str) -> String {
    // Values come from the selected calendar date and configured title format, not note text.
    body(raw)
        .replace("{{date}}", date)
        .replace("{{title}}", title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_local_template_can_be_saved_replaced_and_disabled() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let vault = a.path().to_str().unwrap();
        assert_eq!(read(vault).unwrap(), None);
        assert_eq!(
            set(vault, Some("# {{title}}\n\n- [ ] Plan  \n"), None)
                .unwrap()
                .as_deref(),
            Some("# {{title}}\n\n- [ ] Plan  \n")
        );
        assert_eq!(read(b.path().to_str().unwrap()).unwrap(), None);
        let old = read(vault).unwrap();
        assert_eq!(
            set(vault, Some(""), old.as_deref()).unwrap(),
            Some(String::new())
        );
        let disabled = set(vault, None, Some("")).unwrap().unwrap();
        assert!(!is_enabled(&disabled));
        assert_eq!(body(&disabled), "");
        assert!(a.path().join(RELATIVE_PATH).exists());
        assert_eq!(
            set(vault, Some("enabled again"), Some(&disabled))
                .unwrap()
                .as_deref(),
            Some("enabled again")
        );
    }

    #[test]
    fn disabling_keeps_the_saved_body_and_reenabling_restores_it() {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().to_str().unwrap();
        let original = "# {{title}}\n\n- [ ] My plan  \n";
        set(vault, Some(original), None).unwrap();
        let disabled = set(vault, None, Some(original)).unwrap().unwrap();
        let state = DailyTemplate::from_raw(Some(disabled.clone()));
        assert!(!state.enabled);
        assert_eq!(state.content, original);
        assert_eq!(
            set(vault, Some(&state.content), Some(&disabled))
                .unwrap()
                .as_deref(),
            Some(original)
        );
    }

    #[test]
    fn stale_updates_and_disables_leave_the_latest_template_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().to_str().unwrap();
        set(vault, Some("original"), None).unwrap();
        set(vault, Some("newer"), Some("original")).unwrap();
        assert!(set(vault, Some("stale"), Some("original")).is_err());
        assert!(set(vault, None, Some("original")).is_err());
        assert_eq!(read(vault).unwrap().as_deref(), Some("newer"));
    }

    #[test]
    fn strips_only_leading_complete_frontmatter_and_preserves_body_bytes() {
        let raw =
            "\u{feff}---\r\nid: source\r\ntitle: Source\r\n---\r\n\r\n## Plan\r\n- [ ] Task  \r\n";
        assert_eq!(body(raw), "\r\n## Plan\r\n- [ ] Task  \r\n");
        assert_eq!(body("---\nA horizontal rule\n"), "---\nA horizontal rule\n");
        assert_eq!(
            body("Text\n---\nid: not metadata\n---\n"),
            "Text\n---\nid: not metadata\n---\n"
        );
        assert_eq!(body("---\n---\n"), "");
    }

    #[test]
    fn substitutes_only_the_two_documented_tokens() {
        assert_eq!(
            expand(
                "# {{title}}\n{{date}} / {{date}} / {{unknown}}\n",
                "2026-02-03",
                "February 3, 2026"
            ),
            "# February 3, 2026\n2026-02-03 / 2026-02-03 / {{unknown}}\n"
        );
    }

    #[test]
    fn bounds_reads_and_writes_and_requires_utf8() {
        assert_eq!(
            read_from(vec![b'x'; MAX_BYTES].as_slice()).unwrap().len(),
            MAX_BYTES
        );
        assert!(read_from(vec![b'x'; MAX_BYTES + 1].as_slice()).is_err());
        assert!(read_from([0xff].as_slice()).is_err());
        let dir = tempfile::tempdir().unwrap();
        let vault = dir.path().to_str().unwrap();
        assert!(set(vault, Some(&"x".repeat(MAX_BYTES + 1)), None).is_err());
        assert!(!dir.path().join(RELATIVE_PATH).exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_linked_metadata_and_linked_templates_without_touching_the_target() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let vault = dir.path().to_str().unwrap();
        fs::write(outside.path().join("daily-template.md"), "outside").unwrap();
        symlink(outside.path(), dir.path().join(".helixnotes")).unwrap();
        assert!(read(vault).is_err());
        assert!(set(vault, Some("bad"), None).is_err());
        fs::remove_file(dir.path().join(".helixnotes")).unwrap();
        fs::create_dir(dir.path().join(".helixnotes")).unwrap();
        symlink(
            outside.path().join("daily-template.md"),
            dir.path().join(RELATIVE_PATH),
        )
        .unwrap();
        assert!(read(vault).is_err());
        assert!(set(vault, Some("bad"), None).is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("daily-template.md")).unwrap(),
            "outside"
        );
    }
}
