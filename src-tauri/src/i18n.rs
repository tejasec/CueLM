//! Native labels and supported preferences share the frontend's bundled locale registry.
use std::sync::OnceLock;

pub fn supported_languages() -> &'static [String] {
    static LANGUAGES: OnceLock<Vec<String>> = OnceLock::new();
    LANGUAGES.get_or_init(|| {
        let registry: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../src/lib/i18n/languages.json"))
                .expect("invalid bundled language registry");
        registry
            .into_iter()
            .map(|entry| {
                entry["code"]
                    .as_str()
                    .expect("missing language code")
                    .to_string()
            })
            .collect()
    })
}

#[cfg(any(desktop, test))]
fn resolve_tag(tag: &str) -> Option<&'static str> {
    let tag = tag
        .trim()
        .split(['.', '@'])
        .next()
        .unwrap_or_default()
        .replace('_', "-")
        .to_ascii_lowercase();
    if let Some(exact) = supported_languages()
        .iter()
        .find(|code| code.to_ascii_lowercase() == tag)
    {
        return Some(exact);
    }
    let mut parts = tag.split('-');
    let base = parts.next()?;
    if base == "pt" {
        return Some(if parts.any(|part| part == "br") {
            "pt-BR"
        } else {
            "pt-PT"
        });
    }
    supported_languages()
        .iter()
        .find(|code| code.as_str() == base)
        .map(String::as_str)
}

#[cfg(any(desktop, test))]
type Catalogs = std::collections::HashMap<&'static str, std::collections::HashMap<String, String>>;

#[cfg(any(desktop, test))]
fn catalogs() -> &'static Catalogs {
    static CATALOGS: OnceLock<Catalogs> = OnceLock::new();
    CATALOGS.get_or_init(|| {
        [
            ("en", include_str!("../../src/lib/i18n/locales/en.json")),
            ("ru", include_str!("../../src/lib/i18n/locales/ru.json")),
            ("nl", include_str!("../../src/lib/i18n/locales/nl.json")),
            ("de", include_str!("../../src/lib/i18n/locales/de.json")),
            ("es", include_str!("../../src/lib/i18n/locales/es.json")),
            ("fr", include_str!("../../src/lib/i18n/locales/fr.json")),
            ("it", include_str!("../../src/lib/i18n/locales/it.json")),
            (
                "pt-PT",
                include_str!("../../src/lib/i18n/locales/pt-PT.json"),
            ),
            (
                "pt-BR",
                include_str!("../../src/lib/i18n/locales/pt-BR.json"),
            ),
        ]
        .into_iter()
        .map(|(code, source)| {
            (
                code,
                serde_json::from_str(source).expect("invalid bundled language catalog"),
            )
        })
        .collect()
    })
}

#[cfg(any(desktop, test))]
pub fn text(language: &str, key: &'static str) -> &'static str {
    let locale =
        if language == "system" || !supported_languages().iter().any(|code| code == language) {
            sys_locale::get_locale()
                .and_then(|tag| resolve_tag(&tag))
                .unwrap_or("en")
        } else {
            resolve_tag(language).unwrap_or("en")
        };
    catalogs()
        .get(locale)
        .and_then(|catalog| catalog.get(key))
        .or_else(|| catalogs().get("en").and_then(|catalog| catalog.get(key)))
        .map(String::as_str)
        .unwrap_or(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_labels_share_the_frontend_catalogs() {
        assert_eq!(text("en", "native.quit"), "Quit");
        assert_eq!(text("ru", "native.quit"), "Выйти");
        assert_eq!(text("ru", "native.show"), "Показать HelixNotes");
        assert_eq!(text("ru", "unknown.key"), "unknown.key");
        for (code, quit) in [
            ("nl", "Afsluiten"),
            ("de", "Beenden"),
            ("es", "Salir"),
            ("fr", "Quitter"),
            ("it", "Esci"),
            ("pt-PT", "Sair"),
            ("pt-BR", "Sair"),
        ] {
            assert_eq!(text(code, "native.quit"), quit, "{code}");
        }
        for code in supported_languages() {
            assert!(catalogs().contains_key(code.as_str()), "missing {code}");
        }
        assert_eq!(supported_languages().len(), catalogs().len());
    }

    #[test]
    fn native_locale_matching_preserves_portuguese_regions() {
        for (tag, expected) in [
            ("nl-BE", "nl"),
            ("de_AT.UTF-8", "de"),
            ("es-MX", "es"),
            ("fr-CA", "fr"),
            ("it-CH", "it"),
            ("ru_RU", "ru"),
            ("pt", "pt-PT"),
            ("pt-PT", "pt-PT"),
            ("pt-AO", "pt-PT"),
            ("pt_BR.UTF-8", "pt-BR"),
            ("pt-Latn-BR", "pt-BR"),
        ] {
            assert_eq!(resolve_tag(tag), Some(expected), "{tag}");
        }
        assert_eq!(resolve_tag("ja-JP"), None);
    }
}
