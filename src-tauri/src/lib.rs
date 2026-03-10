use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::UNIX_EPOCH;
use serde::Serialize;
use tiny_http::{Header, Method, Response, Server, StatusCode};
use reqwest::blocking::multipart;
use sha2::{Digest, Sha256};

/// Download a file from a URL and save directly to workspace — bypasses JS IPC byte transfer.
#[tauri::command]
fn download_and_save_to_workspace(url: &str, file_id: &str, filename: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed (HTTP {})", resp.status()));
    }

    let bytes = resp
        .bytes()
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    save_file_to_workspace_inner(file_id, filename, &bytes)
}

/// Fetch a URL and extract the <title> tag from the HTML response.
#[tauri::command]
fn fetch_page_title(url: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Client error: {e}"))?;
    let resp = client
        .get(url)
        .header("User-Agent", "EasyVault/1.0")
        .send()
        .map_err(|e| format!("Fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    // Read up to 64KB to find the title
    let body = resp.text().map_err(|e| format!("Read failed: {e}"))?;
    let search = if body.len() > 65536 { &body[..65536] } else { &body };
    // Simple regex-free extraction
    if let Some(start) = search.to_lowercase().find("<title") {
        let after = &search[start..];
        if let Some(gt) = after.find('>') {
            let content = &after[gt + 1..];
            if let Some(end) = content.to_lowercase().find("</title") {
                let title = content[..end].trim();
                if !title.is_empty() {
                    // Decode basic HTML entities
                    let decoded = title
                        .replace("&amp;", "&")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                        .replace("&quot;", "\"")
                        .replace("&#39;", "'")
                        .replace("&apos;", "'");
                    return Ok(decoded.chars().take(200).collect());
                }
            }
        }
    }
    Err("No title found".to_string())
}

#[tauri::command]
fn save_file_to_workspace(file_id: &str, filename: &str, bytes: Vec<u8>) -> Result<String, String> {
    save_file_to_workspace_inner(file_id, filename, &bytes)
}

fn save_file_to_workspace_inner(file_id: &str, filename: &str, bytes: &[u8]) -> Result<String, String> {
    let home_dir = std::env::var("HOME").map_err(|e| format!("HOME not set: {e}"))?;

    let safe_file_id: String = file_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    if safe_file_id.is_empty() {
        return Err("Invalid file_id".to_string());
    }

    let safe_filename: String = filename
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' || c == '\0' {
                '_'
            } else {
                c
            }
        })
        .collect();

    if safe_filename.trim().is_empty() {
        return Err("Invalid filename".to_string());
    }

    let mut dir = PathBuf::from(home_dir);
    dir.push("EasyVault Workspace");
    dir.push(safe_file_id);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create workspace folder: {e}"))?;

    let mut full_path = dir;
    full_path.push(safe_filename);
    fs::write(&full_path, bytes).map_err(|e| format!("Failed to write file: {e}"))?;

    Ok(full_path.to_string_lossy().to_string())
}

#[derive(Serialize)]
struct FileStat {
    modified_ms: u128,
    size: u64,
}

#[derive(Serialize)]
struct LocalFolderFile {
    path: String,
    name: String,
    size: u64,
    modified_ms: u128,
}

#[tauri::command]
fn get_file_stat(path: &str) -> Result<FileStat, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to read metadata: {e}"))?;
    let modified = metadata
        .modified()
        .map_err(|e| format!("Failed to read modified time: {e}"))?;
    let modified_ms = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Modified time before epoch: {e}"))?
        .as_millis();

    Ok(FileStat {
        modified_ms,
        size: metadata.len(),
    })
}

#[tauri::command]
fn read_file_bytes(path: &str) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
fn get_default_watch_folder() -> Result<String, String> {
    let home_dir = std::env::var("HOME").map_err(|e| format!("HOME not set: {e}"))?;
    let mut dir = PathBuf::from(home_dir);
    dir.push("Downloads");
    dir.push("ToEasyVault");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create watch folder: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn list_folder_files(path: &str) -> Result<Vec<LocalFolderFile>, String> {
    let dir = PathBuf::from(path);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to ensure folder exists: {e}"))?;

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read folder: {e}"))?;
    let mut files: Vec<LocalFolderFile> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read folder entry: {e}"))?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if name.starts_with('.') {
            continue;
        }

        let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {e}"))?;
        let modified = metadata
            .modified()
            .map_err(|e| format!("Failed to read modified time: {e}"))?;
        let modified_ms = modified
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("Modified time before epoch: {e}"))?
            .as_millis();

        files.push(LocalFolderFile {
            path: path.to_string_lossy().to_string(),
            name,
            size: metadata.len(),
            modified_ms,
        });
    }

    Ok(files)
}

const ONLYOFFICE_RELAY_PORT_DEFAULT: u16 = 17171;
const SUPABASE_ANON_KEY: &str =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jb2tvZW1mbWRvZHpmdHFiamltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTA2NjgsImV4cCI6MjA4ODE4NjY2OH0.YQPrNUVDCgIDYP5054PoRdnDyph70gPcNJZSlHjbUH8";
const ONLYOFFICE_CALLBACK_TARGET: &str =
    "https://ocokoemfmdodzftqbjim.supabase.co/functions/v1/onlyoffice-callback";
const ONLYOFFICE_COMMIT_TARGET: &str =
    "https://ocokoemfmdodzftqbjim.supabase.co/functions/v1/onlyoffice-commit";
const UPLOAD_INIT_URL: &str =
    "https://ocokoemfmdodzftqbjim.supabase.co/functions/v1/upload-init";
const UPLOAD_CHUNK_URL: &str =
    "https://ocokoemfmdodzftqbjim.supabase.co/functions/v1/upload-chunk";
const UPLOAD_COMPLETE_URL: &str =
    "https://ocokoemfmdodzftqbjim.supabase.co/functions/v1/upload-complete";
const FILE_VERSIONS_URL: &str =
    "https://ocokoemfmdodzftqbjim.supabase.co/functions/v1/file-versions";
const CHUNK_SIZE: usize = 5 * 1024 * 1024;

#[derive(Serialize)]
struct OnlyofficeRelayInfo {
    enabled: bool,
    port: u16,
    host_callback_url: String,
    container_callback_url: String,
    target_callback_url: String,
}

#[derive(Default, Serialize, Clone)]
struct OnlyofficeRelayStats {
    callback_count: u64,
    last_status: Option<i64>,
    last_key: Option<String>,
    last_upstream_status: Option<u16>,
    last_upstream_body: Option<String>,
    last_commit_method: Option<String>,
    last_error: Option<String>,
    last_save_status: Option<i64>,
    last_save_key: Option<String>,
    last_save_upstream_status: Option<u16>,
    last_save_upstream_body: Option<String>,
    last_save_commit_method: Option<String>,
    last_save_error: Option<String>,
}

#[derive(Clone)]
struct RelayAuth {
    token: String,
}

fn relay_auth_store() -> &'static Mutex<Option<RelayAuth>> {
    static STORE: OnceLock<Mutex<Option<RelayAuth>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

fn get_relay_auth() -> Option<RelayAuth> {
    relay_auth_store().lock().ok().and_then(|s| s.clone())
}

#[tauri::command]
fn set_onlyoffice_relay_auth(token: String, _api_key: Option<String>) -> Result<(), String> {
    let clean_token = token.trim().to_string();
    if clean_token.is_empty() {
        return Err("token is required".to_string());
    }
    let mut guard = relay_auth_store()
        .lock()
        .map_err(|_| "relay auth lock poisoned".to_string())?;
    *guard = Some(RelayAuth {
        token: clean_token,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Editor config store — holds temporary editor configs for the /editor page
// ---------------------------------------------------------------------------

fn editor_config_store() -> &'static Mutex<HashMap<String, String>> {
    static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
fn store_onlyoffice_editor_config(config_json: String) -> Result<String, String> {
    let session_id = format!("{:016x}", rand_u64());
    let mut guard = editor_config_store()
        .lock()
        .map_err(|_| "editor config lock poisoned".to_string())?;
    // Auto-clean: keep max 5 entries
    while guard.len() >= 5 {
        if let Some(oldest_key) = guard.keys().next().cloned() {
            guard.remove(&oldest_key);
        }
    }
    guard.insert(session_id.clone(), config_json);
    Ok(session_id)
}

/// Simple pseudo-random u64 using system time (no external crate needed)
fn rand_u64() -> u64 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // Mix bits for better distribution
    let mut x = nanos as u64;
    x ^= x >> 13;
    x = x.wrapping_mul(0x2545F4914F6CDD1D);
    x ^= x >> 27;
    x
}

fn relay_stats_store() -> &'static Mutex<OnlyofficeRelayStats> {
    static STORE: OnceLock<Mutex<OnlyofficeRelayStats>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(OnlyofficeRelayStats::default()))
}

fn parse_callback_status(v: &serde_json::Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_f64().map(|n| n as i64))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
}

fn infer_office_ext_from_callback_url(url: &str) -> &'static str {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    if clean.ends_with(".xlsx") {
        return "xlsx";
    }
    if clean.ends_with(".pptx") {
        return "pptx";
    }
    if clean.ends_with(".docx") {
        return "docx";
    }
    "docx"
}

fn is_uuid(s: &str) -> bool {
    // UUID format: 8-4-4-4-12 hex digits with dashes
    s.len() == 36
        && s.chars().enumerate().all(|(i, c)| {
            if i == 8 || i == 13 || i == 18 || i == 23 {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn is_hex_24(s: &str) -> bool {
    s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn extract_file_id_from_key(key: &str) -> Option<String> {
    // Key format: "{uuid}_v{version}_{timestamp}" or "{hex24}_v{version}_{timestamp}"
    // Try UUID first (36 chars with dashes)
    if key.len() >= 36 {
        let candidate = &key[..36];
        if is_uuid(candidate) {
            return Some(candidate.to_string());
        }
    }

    // Fallback: split on "_v" and check first part
    let primary = key.split("_v").next().unwrap_or("").trim();
    if is_uuid(primary) {
        return Some(primary.to_string());
    }
    if is_hex_24(primary) {
        return Some(primary.to_string());
    }

    // Last resort: scan for UUID pattern
    let bytes = key.as_bytes();
    for i in 0..bytes.len() {
        let end = i + 36;
        if end > bytes.len() {
            break;
        }
        if let Some(slice) = key.get(i..end) {
            if is_uuid(slice) {
                return Some(slice.to_string());
            }
        }
    }
    // Scan for 24-char hex (legacy Base44 IDs)
    for i in 0..bytes.len() {
        let end = i + 24;
        if end > bytes.len() {
            break;
        }
        if let Some(slice) = key.get(i..end) {
            if is_hex_24(slice) {
                return Some(slice.to_string());
            }
        }
    }
    None
}

fn is_file_not_found_err(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("404") && lower.contains("file not found")
}

fn relay_port() -> u16 {
    std::env::var("EASYVAULT_ONLYOFFICE_RELAY_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(ONLYOFFICE_RELAY_PORT_DEFAULT)
}

#[tauri::command]
fn get_onlyoffice_relay_info() -> OnlyofficeRelayInfo {
    let port = relay_port();
    OnlyofficeRelayInfo {
        enabled: true,
        port,
        host_callback_url: format!("http://localhost:{port}/onlyoffice-callback"),
        container_callback_url: format!("http://host.docker.internal:{port}/onlyoffice-callback"),
        target_callback_url: ONLYOFFICE_CALLBACK_TARGET.to_string(),
    }
}

#[tauri::command]
fn get_onlyoffice_relay_stats() -> OnlyofficeRelayStats {
    match relay_stats_store().lock() {
        Ok(guard) => guard.clone(),
        Err(_) => OnlyofficeRelayStats {
            last_error: Some("relay stats lock poisoned".to_string()),
            ..OnlyofficeRelayStats::default()
        },
    }
}

#[tauri::command]
fn fetch_text(url: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().map_err(|e| e.to_string())
}

fn extract_upload_id(payload: &serde_json::Value) -> Option<String> {
    payload
        .get("upload_id")
        .and_then(|v| v.as_str())
        .or_else(|| {
            payload
                .get("data")
                .and_then(|d| d.get("upload_id"))
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string())
}

fn extract_file_url(payload: &serde_json::Value) -> Option<String> {
    let keys = [
        "file_url",
        "fileUrl",
        "download_url",
        "downloadUrl",
        "url",
        "public_url",
        "publicUrl",
        "storage_url",
        "storageUrl",
        "upload_url",
        "uploadUrl",
        "path",
        "file_path",
        "filePath",
        "stored_file_url",
        "storedFileUrl",
    ];
    for k in keys {
        if let Some(v) = payload.get(k).and_then(|v| v.as_str()) {
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    if let Some(file) = payload.get("file") {
        if let Some(url) = extract_file_url(file) {
            return Some(url);
        }
    }
    if let Some(item) = payload.get("item") {
        if let Some(url) = extract_file_url(item) {
            return Some(url);
        }
    }
    if let Some(data) = payload.get("data") {
        return extract_file_url(data);
    }
    if let Some(result) = payload.get("result") {
        return extract_file_url(result);
    }
    None
}

fn upload_bytes_to_storage(
    client: &reqwest::blocking::Client,
    auth: &RelayAuth,
    filename: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let total_chunks = std::cmp::max(1, (bytes.len() + CHUNK_SIZE - 1) / CHUNK_SIZE);
    let init_payload = serde_json::json!({
        "token": auth.token,
        "filename": filename,
        "file_name": filename,
        "file_size": bytes.len(),
        "mime_type": "application/octet-stream",
        "chunk_size": CHUNK_SIZE,
        "total_chunks": total_chunks,
    });
    let init_res = client
        .post(UPLOAD_INIT_URL)
        .header("Content-Type", "application/json")
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", auth.token))
        .body(init_payload.to_string())
        .send()
        .map_err(|e| format!("upload init request failed: {e}"))?;
    let init_status = init_res.status().as_u16();
    let init_json = init_res
        .json::<serde_json::Value>()
        .map_err(|e| format!("upload init decode failed: {e}"))?;
    if init_status < 200 || init_status >= 300 {
        return Err(format!("upload init failed ({init_status}): {init_json}"));
    }
    let upload_id = extract_upload_id(&init_json).ok_or_else(|| format!("upload init missing upload_id: {init_json}"))?;
    let mut file_url = extract_file_url(&init_json);
    let mut complete_debug: Option<String> = None;
    let mut chunk_urls: Vec<String> = Vec::new();

    for i in 0..total_chunks {
        let start = i * CHUNK_SIZE;
        let end = std::cmp::min(start + CHUNK_SIZE, bytes.len());
        let chunk = bytes[start..end].to_vec();
        let part = multipart::Part::bytes(chunk).file_name(filename.to_string());
        let form = multipart::Form::new()
            .text("token", auth.token.clone())
            .text("upload_id", upload_id.clone())
            .text("chunk_index", i.to_string())
            .part("chunk", part);
        let chunk_res = client
            .post(UPLOAD_CHUNK_URL)
            .header("apikey", SUPABASE_ANON_KEY)
            .header("Authorization", format!("Bearer {}", auth.token))
            .multipart(form)
            .send()
            .map_err(|e| format!("chunk upload request failed: {e}"))?;
        let chunk_status = chunk_res.status().as_u16();
        let chunk_json = chunk_res
            .json::<serde_json::Value>()
            .map_err(|e| format!("chunk upload decode failed: {e}"))?;
        if chunk_status < 200 || chunk_status >= 300 {
            return Err(format!("chunk upload failed ({chunk_status}): {chunk_json}"));
        }
        if let Some(url) = extract_file_url(&chunk_json) {
            file_url = Some(url.clone());
            chunk_urls.push(url);
        }
    }

    if file_url.is_none() {
        let complete_payload = serde_json::json!({
            "token": auth.token,
            "upload_id": upload_id,
            "filename": filename,
            "total_chunks": total_chunks,
            "chunk_urls": chunk_urls,
            "chunkUrls": chunk_urls,
            "chunk_urls_csv": chunk_urls.join(","),
        });
        let complete_res = client
            .post(UPLOAD_COMPLETE_URL)
            .header("Content-Type", "application/json")
            .header("apikey", SUPABASE_ANON_KEY)
            .header("Authorization", format!("Bearer {}", auth.token))
            .body(complete_payload.to_string())
            .send()
            .map_err(|e| format!("upload complete request failed: {e}"))?;
        let complete_status = complete_res.status().as_u16();
        let complete_json = complete_res
            .json::<serde_json::Value>()
            .map_err(|e| format!("upload complete decode failed: {e}"))?;
        if complete_status < 200 || complete_status >= 300 {
            return Err(format!("upload complete failed ({complete_status}): {complete_json}"));
        }
        complete_debug = Some(complete_json.to_string());
        file_url = extract_file_url(&complete_json);
    }

    file_url.ok_or_else(|| format!(
        "upload completed but file_url missing; init={init_json}; complete={}",
        complete_debug.unwrap_or_else(|| "not_called".to_string())
    ))
}

fn call_onlyoffice_commit(
    client: &reqwest::blocking::Client,
    auth: &RelayAuth,
    key: &str,
    status: i64,
    users: &[String],
    file_url: &str,
    file_size: usize,
) -> Result<(), String> {
    let normalized_key = key.replace("_V", "_v");
    let file_id_guess = extract_file_id_from_key(key).unwrap_or_default();
    let payload = serde_json::json!({
        "token": auth.token,
        "key": normalized_key,
        "original_key": key,
        "file_id": file_id_guess,
        "status": status,
        "users": users,
        "file_url": file_url,
        "file_size": file_size,
    });
    let res = client
        .post(ONLYOFFICE_COMMIT_TARGET)
        .header("Content-Type", "application/json")
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", auth.token))
        .body(payload.to_string())
        .send()
        .map_err(|e| format!("onlyofficeCommit request failed: {e}"))?;
    let status_code = res.status().as_u16();
    let body = res.text().unwrap_or_default();
    if status_code < 200 || status_code >= 300 {
        return Err(format!("onlyofficeCommit failed ({status_code}): {body}"));
    }
    Ok(())
}

fn call_file_versions_fallback(
    client: &reqwest::blocking::Client,
    auth: &RelayAuth,
    file_id: &str,
    file_url: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let checksum = hex::encode(Sha256::digest(bytes));
    let payload = serde_json::json!({
        "token": auth.token,
        "fileId": file_id,
        "file_url": file_url,
        "checksum": checksum,
        "change_summary": "ONLYOFFICE relay save",
    });
    let res = client
        .post(FILE_VERSIONS_URL)
        .header("Content-Type", "application/json")
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {}", auth.token))
        .body(payload.to_string())
        .send()
        .map_err(|e| format!("fileVersions request failed: {e}"))?;
    let status_code = res.status().as_u16();
    let body = res.text().unwrap_or_default();
    if status_code < 200 || status_code >= 300 {
        return Err(format!("fileVersions failed ({status_code}): {body}"));
    }
    Ok(())
}

fn start_onlyoffice_callback_relay() {
    let port = relay_port();
    thread::spawn(move || {
        let bind_addr = format!("0.0.0.0:{port}");
        let server = match Server::http(&bind_addr) {
            Ok(s) => s,
            Err(err) => {
                eprintln!("[onlyoffice-relay] failed to bind {bind_addr}: {err}");
                return;
            }
        };
        eprintln!("[onlyoffice-relay] listening on http://{bind_addr}/onlyoffice-callback");

        let client = match reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
        {
            Ok(c) => c,
            Err(err) => {
                eprintln!("[onlyoffice-relay] failed to create http client: {err}");
                return;
            }
        };

        for mut request in server.incoming_requests() {
            let path = request.url().to_string();
            let method = request.method().clone();

            if method == Method::Get && path == "/health" {
                let _ = request.respond(Response::from_string("ok"));
                continue;
            }

            // ── /editor?id=XXX — serve the ONLYOFFICE editor HTML shell ──
            if method == Method::Get && path.starts_with("/editor") && !path.starts_with("/editor-config") {
                let editor_html = r##"<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#1a1a2e}
#oo-editor{width:100%;height:100%}
#status{position:fixed;top:0;left:0;right:0;padding:12px 20px;font-family:sans-serif;font-size:14px;color:#ccc;background:#1a1a2e;z-index:99999}
#status .err{color:#ff6b6b}
</style>
</head><body>
<div id="oo-editor"></div>
<div id="status">Loading ONLYOFFICE editor...</div>
<script>
(async function() {
  var el = document.getElementById("status");
  function log(msg) { el.textContent = msg; console.log("[oo-editor] " + msg); }
  function err(msg) { el.innerHTML = '<span class="err">' + msg + '</span>'; console.error("[oo-editor] " + msg); }
  try {
    var params = new URLSearchParams(location.search);
    var id = params.get("id");
    if (!id) throw new Error("Missing session id");

    log("Fetching editor config...");
    var resp = await fetch("/editor-config?id=" + encodeURIComponent(id));
    if (!resp.ok) throw new Error("Config fetch failed (HTTP " + resp.status + ")");
    var data = await resp.json();
    if (data.error) throw new Error("Config error: " + data.error);

    var serverUrl = (data.documentServerUrl || "").replace(/\/+$/, "");
    if (!serverUrl) throw new Error("Missing documentServerUrl in config");
    log("Loading api.js from " + serverUrl + "...");

    var script = document.createElement("script");
    script.src = serverUrl + "/web-apps/apps/api/documents/api.js";
    script.onload = function() {
      log("api.js loaded, creating editor...");
      if (typeof DocsAPI === "undefined" || !DocsAPI.DocEditor) {
        err("DocsAPI not found after loading api.js");
        parent.postMessage({type:"oo-error", detail:"DocsAPI not found"}, "*");
        return;
      }
      var config = data.config || {};
      config.width = "100%";
      config.height = "100%";
      config.events = {
        onAppReady: function() {
          el.style.display = "none";
          parent.postMessage({type:"oo-ready"}, "*");
        },
        onError: function(e) {
          err("Editor error: " + JSON.stringify(e));
          parent.postMessage({type:"oo-error", detail: JSON.stringify(e)}, "*");
        },
        onWarning: function(e) { parent.postMessage({type:"oo-warning", detail: JSON.stringify(e)}, "*"); },
        onRequestClose: function() { parent.postMessage({type:"oo-close"}, "*"); },
        onDocumentStateChange: function(e) { parent.postMessage({type:"oo-state", detail: e}, "*"); }
      };
      try {
        new DocsAPI.DocEditor("oo-editor", config);
        log("DocEditor created, waiting for onAppReady...");
        parent.postMessage({type:"oo-mounted"}, "*");
      } catch(e) {
        err("DocEditor init failed: " + e.message);
        parent.postMessage({type:"oo-error", detail: "DocEditor init failed: " + e.message}, "*");
      }
    };
    script.onerror = function() {
      err("Failed to load api.js from " + serverUrl);
      parent.postMessage({type:"oo-error", detail: "Failed to load api.js from " + serverUrl}, "*");
    };
    document.head.appendChild(script);
  } catch(e) {
    err(e.message);
    parent.postMessage({type:"oo-error", detail: e.message}, "*");
  }
})();
</script>
</body></html>"##;
                let mut response = Response::from_string(editor_html)
                    .with_status_code(StatusCode(200));
                if let Ok(header) = Header::from_bytes("Content-Type", b"text/html; charset=utf-8") {
                    response = response.with_header(header);
                }
                let _ = request.respond(response);
                continue;
            }

            // ── /editor-config?id=XXX — return stored editor config JSON ──
            if method == Method::Get && path.starts_with("/editor-config") {
                let query_id = path.split("id=").nth(1).unwrap_or("").split('&').next().unwrap_or("");
                let config_json = if !query_id.is_empty() {
                    editor_config_store()
                        .lock()
                        .ok()
                        .and_then(|store| store.get(query_id).cloned())
                } else {
                    None
                };
                match config_json {
                    Some(json) => {
                        let mut response = Response::from_string(json)
                            .with_status_code(StatusCode(200));
                        if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
                            response = response.with_header(header);
                        }
                        let _ = request.respond(response);
                    }
                    None => {
                        let _ = request.respond(
                            Response::from_string(r#"{"error":"session not found or expired"}"#)
                                .with_status_code(StatusCode(404)),
                        );
                    }
                }
                continue;
            }

            if method != Method::Post || path != "/onlyoffice-callback" {
                let _ = request.respond(
                    Response::from_string("not found")
                        .with_status_code(StatusCode(404)),
                );
                continue;
            }

            let mut body = Vec::new();
            if let Err(err) = request.as_reader().read_to_end(&mut body) {
                eprintln!("[onlyoffice-relay] failed to read callback body: {err}");
                if let Ok(mut stats) = relay_stats_store().lock() {
                    stats.last_error = Some(format!("read body error: {err}"));
                }
                let _ = request.respond(
                    Response::from_string(r#"{"error":1,"message":"bad request"}"#)
                        .with_status_code(StatusCode(400)),
                );
                continue;
            }

            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) {
                let status = json.get("status").and_then(parse_callback_status);
                let key = json.get("key").and_then(|v| v.as_str()).map(|s| s.to_string());
                let callback_url = json.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                if let Ok(mut stats) = relay_stats_store().lock() {
                    stats.callback_count = stats.callback_count.saturating_add(1);
                    stats.last_status = status;
                    stats.last_key = key;
                    stats.last_upstream_body = callback_url;
                    stats.last_error = None;
                }

                // Handle local ONLYOFFICE save callbacks end-to-end in relay.
                if matches!(status, Some(2) | Some(6)) {
                    let key = json.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let callback_url = json.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if let Ok(mut stats) = relay_stats_store().lock() {
                        stats.last_save_status = status;
                        stats.last_save_key = Some(key.clone());
                        stats.last_save_upstream_body = Some(callback_url.clone());
                        stats.last_save_error = None;
                        stats.last_save_commit_method = None;
                    }
                    if !key.is_empty() && !callback_url.is_empty() {
                        let localish = callback_url.contains("localhost")
                            || callback_url.contains("127.0.0.1")
                            || callback_url.contains("host.docker.internal");
                        if localish {
                            let auth = match get_relay_auth() {
                                Some(a) => a,
                                None => {
                                    if let Ok(mut stats) = relay_stats_store().lock() {
                                        stats.last_error = Some("missing relay auth token".to_string());
                                        stats.last_save_error =
                                            Some("missing relay auth token".to_string());
                                    }
                                    let _ = request.respond(
                                        Response::from_string(r#"{"error":1,"message":"missing relay auth"}"#)
                                            .with_status_code(StatusCode(500)),
                                    );
                                    continue;
                                }
                            };

                            let users = json
                                .get("users")
                                .and_then(|v| v.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                        .collect::<Vec<String>>()
                                })
                                .unwrap_or_default();

                            let fetch_url = callback_url.replace("host.docker.internal", "localhost");
                            let download_res = client.get(&fetch_url).send();
                            let bytes = match download_res {
                                Ok(r) => match r.bytes() {
                                    Ok(b) => b.to_vec(),
                                    Err(e) => {
                                        if let Ok(mut stats) = relay_stats_store().lock() {
                                            stats.last_error = Some(format!("download bytes failed: {e}"));
                                            stats.last_save_error =
                                                Some(format!("download bytes failed: {e}"));
                                        }
                                        let _ = request.respond(
                                            Response::from_string(r#"{"error":1,"message":"download bytes failed"}"#)
                                                .with_status_code(StatusCode(502)),
                                        );
                                        continue;
                                    }
                                },
                                Err(e) => {
                                    if let Ok(mut stats) = relay_stats_store().lock() {
                                        stats.last_error = Some(format!("download failed: {e}"));
                                        stats.last_save_error = Some(format!("download failed: {e}"));
                                    }
                                    let _ = request.respond(
                                        Response::from_string(r#"{"error":1,"message":"download failed"}"#)
                                            .with_status_code(StatusCode(502)),
                                    );
                                    continue;
                                }
                            };

                            let ext = infer_office_ext_from_callback_url(&callback_url);
                            let filename = format!("onlyoffice_{}.{}", key, ext);
                            let upload_url = match upload_bytes_to_storage(&client, &auth, &filename, &bytes) {
                                Ok(url) => url,
                                Err(err) => {
                                    if let Ok(mut stats) = relay_stats_store().lock() {
                                        stats.last_error = Some(err.clone());
                                        stats.last_save_error = Some(err.clone());
                                    }
                                    let _ = request.respond(
                                        Response::from_string(format!(r#"{{"error":1,"message":"{}"}}"#, err))
                                            .with_status_code(StatusCode(502)),
                                    );
                                    continue;
                                }
                            };

                            let status_i64 = status.unwrap_or(6);
                            if let Err(commit_err) = call_onlyoffice_commit(
                                &client,
                                &auth,
                                &key,
                                status_i64,
                                &users,
                                &upload_url,
                                bytes.len(),
                            ) {
                                let file_id_guess = extract_file_id_from_key(&key).unwrap_or_default();
                                let fallback_res = if file_id_guess.is_empty() {
                                    // Some ONLYOFFICE callbacks (print/export) do not carry a vault file key.
                                    // Acknowledge to prevent editor warning; skip version commit.
                                    if let Ok(mut stats) = relay_stats_store().lock() {
                                        stats.last_error = None;
                                        stats.last_commit_method = Some("skipped_non_vault_key".to_string());
                                        stats.last_save_commit_method = Some("skipped_non_vault_key".to_string());
                                        stats.last_save_error = None;
                                        stats.last_save_upstream_status = Some(200);
                                        stats.last_save_upstream_body =
                                            Some("relay skipped commit for non-vault callback key".to_string());
                                    }
                                    let mut ok =
                                        Response::from_string(r#"{"error":0}"#).with_status_code(StatusCode(200));
                                    if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
                                        ok = ok.with_header(header);
                                    }
                                    let _ = request.respond(ok);
                                    continue;
                                } else {
                                    call_file_versions_fallback(&client, &auth, &file_id_guess, &upload_url, &bytes)
                                };
                                if let Err(fallback_err) = fallback_res {
                                    // Print/export callbacks can reference transient/non-vault artifacts.
                                    // If both commit paths report file-not-found, acknowledge callback to
                                    // avoid ONLYOFFICE warning popups while preserving normal save strictness.
                                    if is_file_not_found_err(&commit_err) && is_file_not_found_err(&fallback_err) {
                                        if let Ok(mut stats) = relay_stats_store().lock() {
                                            stats.last_error = None;
                                            stats.last_commit_method =
                                                Some("skipped_file_not_found_callback".to_string());
                                            stats.last_save_commit_method =
                                                Some("skipped_file_not_found_callback".to_string());
                                            stats.last_save_error = None;
                                            stats.last_save_upstream_status = Some(200);
                                            stats.last_save_upstream_body = Some(
                                                "relay skipped commit on file-not-found callback (likely print/export)"
                                                    .to_string(),
                                            );
                                        }
                                        let mut ok =
                                            Response::from_string(r#"{"error":0}"#).with_status_code(StatusCode(200));
                                        if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
                                            ok = ok.with_header(header);
                                        }
                                        let _ = request.respond(ok);
                                        continue;
                                    }
                                    if let Ok(mut stats) = relay_stats_store().lock() {
                                        stats.last_error = Some(format!(
                                            "onlyofficeCommit failed: {}; fileVersions fallback failed: {}",
                                            commit_err, fallback_err
                                        ));
                                        stats.last_commit_method = Some("none".to_string());
                                        stats.last_save_commit_method = Some("none".to_string());
                                        stats.last_save_error = stats.last_error.clone();
                                    }
                                    let _ = request.respond(
                                        Response::from_string(
                                            format!(
                                                r#"{{"error":1,"message":"onlyofficeCommit failed: {}; fallback failed: {}"}}"#,
                                                commit_err, fallback_err
                                            )
                                        )
                                        .with_status_code(StatusCode(502)),
                                    );
                                    continue;
                                }
                                if let Ok(mut stats) = relay_stats_store().lock() {
                                    stats.last_upstream_status = Some(200);
                                    stats.last_upstream_body = Some("relay committed via fileVersions fallback".to_string());
                                    stats.last_error = None;
                                    stats.last_commit_method = Some("fileVersions_fallback".to_string());
                                    stats.last_save_upstream_status = Some(200);
                                    stats.last_save_upstream_body =
                                        Some("relay committed via fileVersions fallback".to_string());
                                    stats.last_save_error = None;
                                    stats.last_save_commit_method =
                                        Some("fileVersions_fallback".to_string());
                                }
                                let mut ok = Response::from_string(r#"{"error":0}"#).with_status_code(StatusCode(200));
                                if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
                                    ok = ok.with_header(header);
                                }
                                let _ = request.respond(ok);
                                continue;
                            }

                            if let Ok(mut stats) = relay_stats_store().lock() {
                                stats.last_upstream_status = Some(200);
                                stats.last_upstream_body = Some("relay committed via onlyofficeCommit".to_string());
                                stats.last_error = None;
                                stats.last_commit_method = Some("onlyofficeCommit".to_string());
                                stats.last_save_upstream_status = Some(200);
                                stats.last_save_upstream_body =
                                    Some("relay committed via onlyofficeCommit".to_string());
                                stats.last_save_error = None;
                                stats.last_save_commit_method = Some("onlyofficeCommit".to_string());
                            }
                            let mut ok = Response::from_string(r#"{"error":0}"#).with_status_code(StatusCode(200));
                            if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
                                ok = ok.with_header(header);
                            }
                            let _ = request.respond(ok);
                            continue;
                        }
                    }
                }
            }

            let mut upstream = client
                .post(ONLYOFFICE_CALLBACK_TARGET)
                .header("Content-Type", "application/json")
                .header("apikey", SUPABASE_ANON_KEY)
                .body(body);

            if let Some(auth_header) = request.headers().iter().find(|h| h.field.equiv("Authorization")) {
                upstream = upstream.header("Authorization", auth_header.value.as_str());
            } else if let Some(auth) = get_relay_auth() {
                upstream = upstream.header("Authorization", format!("Bearer {}", auth.token));
            }

            match upstream.send() {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let body_text = match resp.text() {
                        Ok(t) => t,
                        Err(_) => String::new(),
                    };
                    if let Ok(mut stats) = relay_stats_store().lock() {
                        stats.last_upstream_status = Some(status);
                        stats.last_upstream_body = Some(body_text.chars().take(300).collect());
                        stats.last_error = None;
                        if matches!(stats.last_save_status, Some(2) | Some(6))
                            && stats.last_save_commit_method.is_none()
                        {
                            stats.last_save_upstream_status = Some(status);
                            stats.last_save_upstream_body = stats.last_upstream_body.clone();
                        }
                    }
                    if status >= 200 && status < 300 {
                        // ONLYOFFICE expects exactly {"error":0} on callback success.
                        let mut response = Response::from_string(r#"{"error":0}"#).with_status_code(StatusCode(200));
                        if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
                            response = response.with_header(header);
                        }
                        let _ = request.respond(response);
                    } else {
                        let message = format!(r#"{{"error":1,"message":"upstream status {status}"}}"#);
                        let mut response = Response::from_string(message).with_status_code(StatusCode(502));
                        if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
                            response = response.with_header(header);
                        }
                        let _ = request.respond(response);
                    }
                }
                Err(err) => {
                    eprintln!("[onlyoffice-relay] upstream callback failed: {err}");
                    if let Ok(mut stats) = relay_stats_store().lock() {
                        stats.last_upstream_status = None;
                        stats.last_upstream_body = None;
                        stats.last_error = Some(format!("upstream failed: {err}"));
                    }
                    let _ = request.respond(
                        Response::from_string(r#"{"error":1,"message":"relay upstream failed"}"#)
                            .with_status_code(StatusCode(502)),
                    );
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_onlyoffice_callback_relay();
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            download_and_save_to_workspace,
            fetch_page_title,
            save_file_to_workspace,
            get_file_stat,
            read_file_bytes,
            get_default_watch_folder,
            list_folder_files,
            get_onlyoffice_relay_info,
            get_onlyoffice_relay_stats,
            set_onlyoffice_relay_auth,
            fetch_text,
            store_onlyoffice_editor_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
