//! Explicitly selected local images. No URL fetching, data-URI passthrough or metadata uploads.
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageDecoder, ImageFormat, ImageReader};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path},
};

pub const MAX_IMAGES: usize = 4;
const MAX_INPUT: u64 = 10 * 1024 * 1024;
const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const MAX_PIXELS: u64 = 20_000_000;
const MAX_SIDE: u32 = 1568;

pub struct AiImage {
    pub media_type: &'static str,
    pub data: String,
}

fn check_lexical_scope(root: &Path, configured: &Path, requested: &Path) -> Result<(), String> {
    if !requested.is_absolute() {
        return Err("AI context paths must be absolute local paths".into());
    }
    #[cfg(windows)]
    let (root, configured, requested) = (
        std::path::PathBuf::from(root.to_string_lossy().to_lowercase()),
        std::path::PathBuf::from(configured.to_string_lossy().to_lowercase()),
        std::path::PathBuf::from(requested.to_string_lossy().to_lowercase()),
    );
    #[cfg(windows)]
    let (root, configured, requested) = (root.as_path(), configured.as_path(), requested.as_path());
    let relative = requested
        .strip_prefix(root)
        .or_else(|_| requested.strip_prefix(configured))
        .map_err(|_| "AI context paths must stay inside the configured vault")?;
    if relative
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("AI context paths must not traverse outside their approved scope".into());
    }
    Ok(())
}

fn allowed_target(
    vault: &Path,
    configured: &Path,
    requested: &Path,
) -> Result<std::path::PathBuf, String> {
    // Reject other roots (including UNC shares) before filesystem resolution.
    check_lexical_scope(vault, configured, requested)?;
    let target = fs::canonicalize(requested).map_err(|_| "AI image could not be resolved")?;
    let relative = target
        .strip_prefix(vault)
        .map_err(|_| "AI images must stay inside the note's configured vault")?;
    if relative.starts_with(".helixnotes/attachments") {
        for folder in [
            vault.join(".helixnotes"),
            vault.join(".helixnotes/attachments"),
        ] {
            if !fs::symlink_metadata(folder).is_ok_and(|meta| meta.file_type().is_dir()) {
                return Err("AI attachments must not use linked metadata directories".into());
            }
        }
    } else if relative.components().any(|part| match part {
        Component::Normal(name) => name.to_string_lossy().starts_with('.'),
        _ => true,
    }) {
        return Err("Private vault metadata cannot be sent to AI".into());
    }
    if !target.is_file() {
        return Err("AI image must be a regular file".into());
    }
    Ok(target)
}

fn encode(bytes: &[u8]) -> Result<AiImage, String> {
    let format =
        image::guess_format(bytes).map_err(|_| "AI attachment is not a supported image")?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err("AI images must be PNG, JPEG or WebP".into());
    }
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(96 * 1024 * 1024);
    let mut header = ImageReader::with_format(Cursor::new(bytes), format);
    header.limits(limits.clone());
    let (width, height) = header
        .into_dimensions()
        .map_err(|_| "Could not read AI image dimensions within the memory limit")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("AI image exceeds the 20 megapixel limit".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "Could not decode AI image within the memory limit")?;
    let orientation = decoder
        .orientation()
        .map_err(|_| "Could not read AI image orientation")?;
    let mut decoded = image::DynamicImage::from_decoder(decoder)
        .map_err(|_| "Could not decode AI image within the memory limit")?;
    decoded.apply_orientation(orientation);
    let resized = if width > MAX_SIDE || height > MAX_SIDE {
        decoded.thumbnail(MAX_SIDE, MAX_SIDE)
    } else {
        decoded
    };
    let mut encoded = Cursor::new(Vec::new());
    resized
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|_| "Could not encode AI image")?;
    let mut data = encoded.into_inner();
    let mut media_type = "image/png";
    if data.len() > MAX_OUTPUT {
        data.clear();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut data, 85)
            .encode_image(&image::DynamicImage::ImageRgb8(resized.to_rgb8()))
            .map_err(|_| "Could not encode AI image")?;
        media_type = "image/jpeg";
    }
    if data.len() > MAX_OUTPUT {
        return Err("AI image exceeds the encoded size limit".into());
    }
    Ok(AiImage {
        media_type,
        data: STANDARD.encode(data),
    })
}

pub fn prepare(vault: &str, note: &str, paths: &[String]) -> Result<Vec<AiImage>, String> {
    if paths.len() > MAX_IMAGES {
        return Err("Select at most four AI images".into());
    }
    let root = fs::canonicalize(vault).map_err(|_| "Invalid AI note vault")?;
    check_lexical_scope(&root, Path::new(vault), Path::new(note))?;
    let note = fs::canonicalize(note).map_err(|_| "Save the note before including AI images")?;
    if !note.starts_with(&root)
        || note.starts_with(root.join(".helixnotes"))
        || !note.is_file()
        || note.extension().and_then(|s| s.to_str()) != Some("md")
    {
        return Err("AI image context must be a note in the configured vault".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for requested in paths {
        let target = allowed_target(&root, Path::new(vault), Path::new(requested))?;
        if !seen.insert(target.clone()) {
            continue;
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let file = options
            .open(target)
            .map_err(|_| "Could not open AI image")?;
        if !file
            .metadata()
            .is_ok_and(|meta| meta.is_file() && meta.len() <= MAX_INPUT)
        {
            return Err("AI image exceeds the 10 MiB source limit or is not a file".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_INPUT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read AI image")?;
        if bytes.len() as u64 > MAX_INPUT {
            return Err("AI image exceeds the 10 MiB source limit".into());
        }
        result.push(encode(&bytes)?);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, String, String) {
        let root = tempfile::tempdir().unwrap();
        let note = root.path().join("Note.md");
        fs::write(&note, "Note").unwrap();
        let image = root.path().join("screen.png");
        image::RgbaImage::from_pixel(32, 16, image::Rgba([10, 20, 30, 255]))
            .save(&image)
            .unwrap();
        (
            root,
            note.to_string_lossy().into_owned(),
            image.to_string_lossy().into_owned(),
        )
    }
    #[test]
    fn prepares_pixels_not_file_paths_and_deduplicates_images() {
        let (root, note, path) = fixture();
        let result = prepare(root.path().to_str().unwrap(), &note, &[path.clone(), path]).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].media_type, "image/png");
        let bytes = STANDARD.decode(&result[0].data).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (32, 16));
    }
    #[test]
    fn rejects_external_files_urls_data_uris_and_private_metadata() {
        let (root, note, path) = fixture();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("screen.png");
        fs::copy(&path, &outside_file).unwrap();
        let hidden = root.path().join(".helixnotes/private.png");
        fs::create_dir_all(hidden.parent().unwrap()).unwrap();
        fs::copy(&path, &hidden).unwrap();
        for p in [
            outside_file.to_string_lossy().into_owned(),
            hidden.to_string_lossy().into_owned(),
            "https://example.com/a.png".into(),
            "data:image/png;base64,abcd".into(),
        ] {
            assert!(prepare(root.path().to_str().unwrap(), &note, &[p]).is_err());
        }
    }
    #[test]
    fn allows_managed_attachments_but_rejects_missing_context_and_excess_images() {
        let (root, note, path) = fixture();
        let managed = root.path().join(".helixnotes/attachments/screen.png");
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::copy(&path, &managed).unwrap();
        assert!(prepare(
            root.path().to_str().unwrap(),
            &note,
            &[managed.to_string_lossy().into_owned()]
        )
        .is_ok());
        assert!(prepare(
            root.path().to_str().unwrap(),
            "missing.md",
            std::slice::from_ref(&path)
        )
        .is_err());
        assert!(prepare(root.path().to_str().unwrap(), &note, &vec![path; 5]).is_err());
    }
    #[test]
    fn rejects_other_roots_and_traversal_before_probing_files() {
        let (root, note, _) = fixture();
        let missing_outside = root
            .path()
            .parent()
            .unwrap()
            .join("missing-outside/image.png");
        let error = prepare(
            root.path().to_str().unwrap(),
            &note,
            &[missing_outside.to_string_lossy().into_owned()],
        )
        .err()
        .unwrap();
        assert!(error.contains("inside the configured vault"));
        let traversal = root.path().join("../missing-outside/image.png");
        let error = prepare(
            root.path().to_str().unwrap(),
            &note,
            &[traversal.to_string_lossy().into_owned()],
        )
        .err()
        .unwrap();
        assert!(error.contains("must not traverse"));
    }

    #[test]
    fn rejects_oversized_and_disguised_files() {
        let (root, note, path) = fixture();
        fs::write(&path, b"not image bytes").unwrap();
        assert!(prepare(
            root.path().to_str().unwrap(),
            &note,
            std::slice::from_ref(&path)
        )
        .is_err());
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_INPUT + 1)
            .unwrap();
        assert!(prepare(root.path().to_str().unwrap(), &note, &[path]).is_err());
    }
    #[test]
    fn downsizes_large_images_without_modifying_source_files() {
        let (root, note, path) = fixture();
        image::RgbaImage::from_pixel(2000, 1000, image::Rgba([10, 20, 30, 255]))
            .save(&path)
            .unwrap();
        let original = fs::read(&path).unwrap();
        let result = prepare(
            root.path().to_str().unwrap(),
            &note,
            std::slice::from_ref(&path),
        )
        .unwrap();
        let decoded = image::load_from_memory(&STANDARD.decode(&result[0].data).unwrap()).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1568, 784));
        assert_eq!(fs::read(path).unwrap(), original);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_send_images_from_outside_the_vault() {
        use std::os::unix::fs::symlink;
        let (root, note, _) = fixture();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("image.png");
        fs::write(&target, "secret").unwrap();
        let link = root.path().join("link.png");
        symlink(target, &link).unwrap();
        assert!(prepare(
            root.path().to_str().unwrap(),
            &note,
            &[link.to_string_lossy().into_owned()]
        )
        .is_err());
    }
}
