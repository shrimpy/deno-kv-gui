#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    deno_kv_gui_lib::run();
}
