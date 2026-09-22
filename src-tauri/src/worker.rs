use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::process::Stdio;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};

pub struct Worker {
    stdin: ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
    child: Child,
    token_hash: Option<u64>,
    next_id: u64,
}

pub fn fingerprint(token: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    token.hash(&mut hasher);
    hasher.finish()
}

fn deno_program() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("DENO_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    for candidate in ["/usr/local/bin/deno", "/opt/homebrew/bin/deno"] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let candidate = PathBuf::from(dir).join("deno");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err("Deno was not found. Install Deno or set DENO_BIN.".into())
}

fn worker_command(token: Option<&str>) -> Result<tokio::process::Command, String> {
    let mut command = if cfg!(debug_assertions) {
        let mut command = tokio::process::Command::new(deno_program()?);
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/main.ts");
        command
            .arg("run")
            .arg("--unstable-kv")
            .arg("--allow-read")
            .arg("--allow-write")
            .arg("--allow-env")
            .arg("--allow-net")
            .arg(script);
        command
    } else {
        let exe = std::env::current_exe().map_err(|err| err.to_string())?;
        let path = exe
            .parent()
            .ok_or("missing executable directory")?
            .join("kv-worker");
        if !path.is_file() {
            return Err(format!(
                "bundled KV worker is missing at {}",
                path.display()
            ));
        }
        tokio::process::Command::new(path)
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(token) = token {
        command.env("DENO_KV_ACCESS_TOKEN", token);
    } else {
        command.env_remove("DENO_KV_ACCESS_TOKEN");
    }
    Ok(command)
}

pub async fn spawn(token: Option<&str>) -> Result<Worker, String> {
    let token_hash = token.map(fingerprint);
    let mut child = worker_command(token)?.spawn().map_err(|err| err.to_string())?;
    let stdin = child.stdin.take().ok_or("worker stdin missing")?;
    let stdout = child.stdout.take().ok_or("worker stdout missing")?;
    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let text = line.trim_end();
                        if !text.contains("ddo_") {
                            eprintln!("kv-worker: {text}");
                        }
                    }
                }
            }
        });
    }
    Ok(Worker {
        stdin,
        stdout: BufReader::new(stdout),
        child,
        token_hash,
        next_id: 0,
    })
}

impl Worker {
    pub fn token_hash(&self) -> Option<u64> {
        self.token_hash
    }

    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let mut line = serde_json::to_vec(&json!({ "id": id, "method": method, "params": params }))
            .map_err(|err| err.to_string())?;
        line.push(b'\n');
        self.stdin
            .write_all(&line)
            .await
            .map_err(|_| "KV worker stopped".to_string())?;
        self.stdin
            .flush()
            .await
            .map_err(|_| "KV worker stopped".to_string())?;
        let mut response = String::new();
        let read = self
            .stdout
            .read_line(&mut response)
            .await
            .map_err(|_| "KV worker stopped".to_string())?;
        if read == 0 {
            return Err("KV worker stopped".into());
        }
        let value: Value = serde_json::from_str(&response).map_err(|err| err.to_string())?;
        if value.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(value.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("worker error")
                .to_string())
        }
    }
}

pub async fn shutdown(mut worker: Worker) {
    let _ = worker.child.kill().await;
    let _ = worker.child.wait().await;
}
