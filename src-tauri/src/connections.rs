use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const KINDS: &[&str] = &["local-file", "memory", "remote"];
const ENVIRONMENTS: &[&str] = &[
    "local",
    "memory",
    "production",
    "preview",
    "branch",
    "classic",
    "self-hosted",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub environment: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_shape: Option<String>,
    #[serde(default)]
    pub has_token: bool,
}

pub fn load_connections(path: &Path) -> Result<Vec<Connection>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

pub fn save_connections(path: &Path, connections: &[Connection]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(connections).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| err.to_string())
}

pub fn validate(connection: &Connection) -> Result<(), String> {
    if connection.id.trim().is_empty() {
        return Err("connection id is required".into());
    }
    if connection.name.trim().is_empty() {
        return Err("connection name is required".into());
    }
    if !KINDS.contains(&connection.kind.as_str()) {
        return Err("unknown connection kind".into());
    }
    if !ENVIRONMENTS.contains(&connection.environment.as_str()) {
        return Err("unknown environment".into());
    }
    match connection.kind.as_str() {
        "local-file" => {
            let path = connection.path.as_deref().unwrap_or("").trim();
            if path.is_empty() {
                return Err("choose a local database file".into());
            }
        }
        "remote" => {
            let url = connection.url.as_deref().unwrap_or("").trim();
            let id = connection.database_id.as_deref().unwrap_or("").trim();
            if url.is_empty() && id.is_empty() {
                return Err("enter a database id or KV Connect URL".into());
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn open_target(connection: &Connection) -> Result<String, String> {
    validate(connection)?;
    match connection.kind.as_str() {
        "memory" => Ok(":memory:".into()),
        "local-file" => Ok(connection.path.clone().unwrap_or_default()),
        "remote" => {
            if let Some(url) = connection.url.as_deref() {
                let url = url.trim();
                if !url.is_empty() {
                    return Ok(url.to_string());
                }
            }
            let id = connection
                .database_id
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_string();
            if id.is_empty() {
                return Err("database id is required".into());
            }
            match connection.url_shape.as_deref().unwrap_or("v2") {
                "classic" => Ok(format!("https://api.deno.com/databases/{id}/connect")),
                "custom" => Err("custom connections need a KV Connect URL".into()),
                _ => Ok(format!("https://api.deno.com/v2/databases/{id}/connect")),
            }
        }
        _ => Err("unknown connection kind".into()),
    }
}

pub trait SecretStore {
    fn set_secret(&self, id: &str, secret: &str) -> Result<(), String>;
    fn get_secret(&self, id: &str) -> Result<Option<String>, String>;
    fn delete_secret(&self, id: &str) -> Result<(), String>;
}

#[cfg(test)]
#[derive(Default)]
pub struct MemorySecrets {
    values: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for MemorySecrets {
    fn set_secret(&self, id: &str, secret: &str) -> Result<(), String> {
        self.values
            .lock()
            .map_err(|_| "secret store lock".to_string())?
            .insert(id.to_string(), secret.to_string());
        Ok(())
    }

    fn get_secret(&self, id: &str) -> Result<Option<String>, String> {
        Ok(self
            .values
            .lock()
            .map_err(|_| "secret store lock".to_string())?
            .get(id)
            .cloned())
    }

    fn delete_secret(&self, id: &str) -> Result<(), String> {
        self.values
            .lock()
            .map_err(|_| "secret store lock".to_string())?
            .remove(id);
        Ok(())
    }
}

pub struct KeychainStore;

const SERVICE: &str = "deno-kv-gui";

fn security(args: &[&str]) -> Result<std::process::Output, String> {
    std::process::Command::new("/usr/bin/security")
        .args(args)
        .output()
        .map_err(|err| err.to_string())
}

fn missing(output: &std::process::Output) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr);
    stderr.contains("could not be found")
}

impl SecretStore for KeychainStore {
    fn set_secret(&self, id: &str, secret: &str) -> Result<(), String> {
        let output = security(&[
            "add-generic-password",
            "-U",
            "-s",
            SERVICE,
            "-a",
            id,
            "-w",
            secret,
        ])?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    fn get_secret(&self, id: &str) -> Result<Option<String>, String> {
        let output = security(&["find-generic-password", "-s", SERVICE, "-a", id, "-w"])?;
        if output.status.success() {
            let mut text = String::from_utf8(output.stdout).map_err(|err| err.to_string())?;
            if text.ends_with('\n') {
                text.pop();
            }
            Ok(Some(text))
        } else if missing(&output) {
            Ok(None)
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    fn delete_secret(&self, id: &str) -> Result<(), String> {
        let output = security(&["delete-generic-password", "-s", SERVICE, "-a", id])?;
        if output.status.success() || missing(&output) {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
}

pub fn connections_file(dir: &Path) -> PathBuf {
    dir.join("connections.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Connection {
        Connection {
            id: "local-1".into(),
            name: "Local".into(),
            kind: "local-file".into(),
            environment: "local".into(),
            path: Some("/tmp/example.kv".into()),
            url: None,
            database_id: None,
            url_shape: None,
            has_token: false,
        }
    }

    #[test]
    fn connection_file_has_no_secret() {
        let dir = std::env::temp_dir().join(format!("deno-kv-gui-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = connections_file(&dir);
        let connection = sample();
        save_connections(&path, &[connection.clone()]).unwrap();
        let secrets = MemorySecrets::default();
        secrets
            .set_secret(&connection.id, "ddo_super_secret")
            .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("ddo_super_secret"));
        assert!(!text.contains("\"token\""));
        assert_eq!(
            secrets.get_secret(&connection.id).unwrap().as_deref(),
            Some("ddo_super_secret")
        );
        let loaded = load_connections(&path).unwrap();
        assert_eq!(loaded, vec![connection]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keychain_round_trip() {
        let id = format!("deno-kv-gui-test-{}", std::process::id());
        let store = KeychainStore;
        store.set_secret(&id, "ddo_test_token").unwrap();
        assert_eq!(
            store.get_secret(&id).unwrap().as_deref(),
            Some("ddo_test_token")
        );
        store.delete_secret(&id).unwrap();
        assert_eq!(store.get_secret(&id).unwrap(), None);
        let dir = std::env::temp_dir().join(format!("deno-kv-gui-keychain-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = connections_file(&dir);
        let mut connection = sample();
        connection.id = id;
        connection.has_token = true;
        save_connections(&path, &[connection]).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("ddo_test_token"));
        let _ = fs::remove_dir_all(&dir);
    }
}
