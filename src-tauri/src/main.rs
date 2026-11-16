// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(desktop)]
    if app_lib::mcp::run_cli_if_requested() {
        return;
    }
    app_lib::run();
}
