mod connections;
mod deploy;
mod worker;

use std::path::PathBuf;

use connections::{open_target, validate, Connection, KeychainStore, SecretStore};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use worker::Worker;

struct AppState {
    worker: Mutex<Option<Worker>>,
}

fn connections_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(connections::connections_file(&dir))
}

fn read_connections(app: &AppHandle) -> Result<Vec<Connection>, String> {
    connections::load_connections(&connections_path(app)?)
}

fn write_connections(app: &AppHandle, items: &[Connection]) -> Result<(), String> {
    connections::save_connections(&connections_path(app)?, items)
}

async fn ensure_worker(state: &AppState, token: Option<String>) -> Result<(), String> {
    let next_hash = token.as_deref().map(worker::fingerprint);
    let mut slot = state.worker.lock().await;
    if slot.as_ref().map(Worker::token_hash) == Some(next_hash) && slot.is_some() {
        return Ok(());
    }
    if let Some(current) = slot.take() {
        worker::shutdown(current).await;
    }
    *slot = Some(worker::spawn(token.as_deref()).await?);
    Ok(())
}

async fn worker_call(state: &AppState, method: &str, params: Value) -> Result<Value, String> {
    let mut slot = state.worker.lock().await;
    let worker = slot.as_mut().ok_or("KV worker is not running")?;
    match worker.call(method, params).await {
        Ok(value) => Ok(value),
        Err(err) if err == "KV worker stopped" => {
            if let Some(current) = slot.take() {
                worker::shutdown(current).await;
            }
            Err(err)
        }
        Err(err) => Err(err),
    }
}

#[tauri::command]
async fn ping(state: State<'_, AppState>) -> Result<Value, String> {
    ensure_worker(&state, None).await?;
    worker_call(&state, "ping", json!({})).await
}

#[tauri::command]
fn list_connections(app: AppHandle) -> Result<Vec<Connection>, String> {
    read_connections(&app)
}

#[tauri::command]
fn save_connection(
    app: AppHandle,
    connection: Connection,
    token: Option<String>,
) -> Result<Connection, String> {
    validate(&connection)?;
    let mut connection = connection;
    let store = KeychainStore;
    if let Some(token) = token.as_deref() {
        if token.is_empty() {
            store.delete_secret(&connection.id)?;
            connection.has_token = false;
        } else {
            store.set_secret(&connection.id, token)?;
            connection.has_token = true;
        }
    }
    let mut items = read_connections(&app)?;
    if let Some(existing) = items.iter_mut().find(|item| item.id == connection.id) {
        if token.is_none() {
            connection.has_token = existing.has_token;
        }
        *existing = connection.clone();
    } else {
        items.push(connection.clone());
    }
    write_connections(&app, &items)?;
    Ok(connection)
}

#[tauri::command]
fn delete_connection(app: AppHandle, id: String) -> Result<(), String> {
    let store = KeychainStore;
    let _ = store.delete_secret(&id);
    let items = read_connections(&app)?
        .into_iter()
        .filter(|item| item.id != id)
        .collect::<Vec<_>>();
    write_connections(&app, &items)
}

#[tauri::command]
async fn kv_open(state: State<'_, AppState>, app: AppHandle, id: String) -> Result<Value, String> {
    let connection = read_connections(&app)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or("connection not found")?;
    let target = open_target(&connection)?;
    let token = if connection.kind == "remote" {
        let secret = KeychainStore
            .get_secret(&connection.id)?
            .ok_or("save an access token for this remote database")?;
        Some(secret)
    } else {
        None
    };
    ensure_worker(&state, token).await?;
    worker_call(&state, "open", json!({ "target": target })).await
}

#[tauri::command]
async fn kv_close(state: State<'_, AppState>) -> Result<Value, String> {
    ensure_worker(&state, None).await?;
    worker_call(&state, "close", json!({})).await
}

#[tauri::command]
async fn kv_call(
    state: State<'_, AppState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    worker_call(&state, &method, params).await
}

#[tauri::command]
async fn deploy_list(
    connection_id: Option<String>,
    token: Option<String>,
) -> Result<deploy::DeployList, String> {
    let secret = if let Some(token) = token.as_deref().map(str::trim).filter(|token| !token.is_empty()) {
        token.to_string()
    } else if let Some(id) = connection_id {
        KeychainStore
            .get_secret(&id)?
            .ok_or("save an access token first")?
    } else {
        return Err("access token is required".into());
    };
    deploy::list_databases(&secret).await
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(path, contents).map_err(|err| err.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            worker: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            list_connections,
            save_connection,
            delete_connection,
            kv_open,
            kv_close,
            kv_call,
            deploy_list,
            write_text_file,
            read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Deno KV");
}
