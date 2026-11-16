pub mod daily_template;
pub mod frontmatter;
pub mod import;
pub mod operations;
#[cfg(target_os = "linux")]
mod portal_watcher;
pub mod watcher;

#[cfg(test)]
mod daily_template_tests;
#[cfg(test)]
mod note_import_tests;
