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
/// Streams to disk (no whole-file RAM buffer). Explicit timeouts: 30s to connect, 600s
/// overall — the blocking client's implicit default is 30s TOTAL, which would kill any
/// large download; 600s bounds a stalled transfer without breaking slow links.
#[tauri::command]
fn download_and_save_to_workspace(url: &str, file_id: &str, filename: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Client error: {e}"))?;
    let mut resp = client
        .get(url)
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed (HTTP {})", resp.status()));
    }

    let full_path = workspace_target_path(file_id, filename)?;
    // Stream into a temp file first so a failed download never truncates or
    // corrupts an existing workspace copy.
    let tmp_name = format!(
        "{}.evdownload",
        full_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("download")
    );
    let tmp_path = full_path.with_file_name(tmp_name);
    let mut file =
        fs::File::create(&tmp_path).map_err(|e| format!("Failed to create file: {e}"))?;
    if let Err(e) = resp.copy_to(&mut file) {
        drop(file);
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Failed to write file: {e}"));
    }
    drop(file);
    fs::rename(&tmp_path, &full_path).map_err(|e| format!("Failed to finalize file: {e}"))?;

    Ok(full_path.to_string_lossy().to_string())
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
    let search = body.get(..65536).unwrap_or(&body);
    // Simple regex-free extraction
    if let Some(start) = find_ascii_ci(search, "<title") {
        let after = &search[start..];
        if let Some(gt) = after.find('>') {
            let content = &after[gt + 1..];
            if let Some(end) = find_ascii_ci(content, "</title") {
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

/// Case-insensitive ASCII substring search returning a byte offset valid for the
/// ORIGINAL string (unlike to_lowercase(), which can change byte lengths on
/// non-ASCII input, e.g. 'İ'). Needles must be pure ASCII; a match on an ASCII
/// first byte is always a char boundary in the haystack.
fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || h.len() < n.len() {
        return None;
    }
    h.windows(n.len()).position(|w| w.eq_ignore_ascii_case(n))
}

/// Resolve the user's home directory. HOME is absent on native Windows,
/// where USERPROFILE is the equivalent.
fn resolve_home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not resolve home directory (HOME/USERPROFILE not set)".to_string())
}

#[tauri::command]
fn save_file_to_workspace(file_id: &str, filename: &str, bytes: Vec<u8>) -> Result<String, String> {
    save_file_to_workspace_inner(file_id, filename, &bytes)
}

/// Keep only characters safe for a workspace directory name; None if nothing remains.
fn sanitize_file_id(file_id: &str) -> Option<String> {
    let safe: String = file_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() {
        None
    } else {
        Some(safe)
    }
}

/// Replace path separators, drive colons and NUL with '_'; None if the result is blank.
fn sanitize_filename(filename: &str) -> Option<String> {
    let safe: String = filename
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' || c == '\0' {
                '_'
            } else {
                c
            }
        })
        .collect();
    if safe.trim().is_empty() {
        None
    } else {
        Some(safe)
    }
}

fn save_file_to_workspace_inner(file_id: &str, filename: &str, bytes: &[u8]) -> Result<String, String> {
    let full_path = workspace_target_path(file_id, filename)?;
    fs::write(&full_path, bytes).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(full_path.to_string_lossy().to_string())
}

/// Sanitize file_id/filename and return the target path inside the workspace,
/// creating the per-file directory if needed.
fn workspace_target_path(file_id: &str, filename: &str) -> Result<PathBuf, String> {
    let home_dir = resolve_home_dir()?;

    let safe_file_id = sanitize_file_id(file_id).ok_or_else(|| "Invalid file_id".to_string())?;
    let safe_filename = sanitize_filename(filename).ok_or_else(|| "Invalid filename".to_string())?;

    let mut dir = PathBuf::from(home_dir);
    dir.push("EasyVault Workspace");
    dir.push(safe_file_id);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create workspace folder: {e}"))?;

    let mut full_path = dir;
    full_path.push(safe_filename);
    Ok(full_path)
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
fn get_cpu_arch() -> String {
    std::env::consts::ARCH.into()
}

#[tauri::command]
fn get_default_watch_folder() -> Result<String, String> {
    let home_dir = resolve_home_dir()?;
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
    /// ONLYOFFICE outbox-JWT secret, when the frontend has one to hand over.
    /// Optional because the shipped app no longer bakes a secret in; see
    /// onlyoffice_jwt_secret() for the full source list.
    onlyoffice_jwt_secret: Option<String>,
}

fn relay_auth_store() -> &'static Mutex<Option<RelayAuth>> {
    static STORE: OnceLock<Mutex<Option<RelayAuth>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

fn get_relay_auth() -> Option<RelayAuth> {
    relay_auth_store().lock().ok().and_then(|s| s.clone())
}

#[tauri::command]
fn set_onlyoffice_relay_auth(
    token: String,
    _api_key: Option<String>,
    onlyoffice_jwt_secret: Option<String>,
) -> Result<(), String> {
    let clean_token = token.trim().to_string();
    if clean_token.is_empty() {
        return Err("token is required".to_string());
    }
    let clean_secret = onlyoffice_jwt_secret
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut guard = relay_auth_store()
        .lock()
        .map_err(|_| "relay auth lock poisoned".to_string())?;
    // Merge rather than clobber: the Supabase token is re-pushed on every relay
    // setup / token refresh, and a call that omits the secret must not silently
    // disarm callback verification for the rest of the session.
    let previous_secret = guard.as_ref().and_then(|a| a.onlyoffice_jwt_secret.clone());
    *guard = Some(RelayAuth {
        token: clean_token,
        onlyoffice_jwt_secret: clean_secret.or(previous_secret),
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Editor config store — holds temporary editor configs for the /editor page
// ---------------------------------------------------------------------------

/// Insertion-ordered (FIFO) store so eviction genuinely drops the OLDEST session —
/// HashMap iteration order is arbitrary. Max 5 entries, so O(n) lookup is trivial.
fn editor_config_store() -> &'static Mutex<Vec<(String, String)>> {
    static STORE: OnceLock<Mutex<Vec<(String, String)>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Vec::new()))
}

#[tauri::command]
fn store_onlyoffice_editor_config(config_json: String) -> Result<String, String> {
    let session_id = random_session_id();
    let mut guard = editor_config_store()
        .lock()
        .map_err(|_| "editor config lock poisoned".to_string())?;
    // Auto-clean: keep max 5 entries, evicting the oldest first
    while guard.len() >= 5 {
        guard.remove(0);
    }
    guard.push((session_id.clone(), config_json));
    Ok(session_id)
}

/// Cryptographically-strong random session id (128-bit, hex-encoded).
/// Used as the only guard on the unauthenticated /editor-config endpoint,
/// so it must be unguessable — never derive it from wall-clock time.
fn random_session_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("OS RNG unavailable");
    hex::encode(bytes)
}

fn relay_stats_store() -> &'static Mutex<OnlyofficeRelayStats> {
    static STORE: OnceLock<Mutex<OnlyofficeRelayStats>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(OnlyofficeRelayStats::default()))
}

/// Lenient JSON → i64. ONLYOFFICE has been observed sending numeric fields as
/// integers, floats and quoted strings depending on version and hop.
fn json_i64(v: &serde_json::Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_f64().map(|n| n as i64))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
}

fn parse_callback_status(v: &serde_json::Value) -> Option<i64> {
    json_i64(v)
}

// ---------------------------------------------------------------------------
// ONLYOFFICE outbox-JWT verification
// ---------------------------------------------------------------------------
//
// The relay's /onlyoffice-callback endpoint acts on saves: it downloads the
// edited bytes, chunk-uploads them to Supabase and commits a new version of a
// vault file using the signed-in user's token. Binding loopback is NOT an
// authentication boundary — any page open in the user's browser can POST a
// text/plain body to http://localhost:17171/onlyoffice-callback as a
// CORS-simple request, and with only the file UUID it could replace a vault
// document with content of its choosing.
//
// So every callback the relay ACTS on must carry ONLYOFFICE's own outbox JWT,
// HMAC-SHA256 over ONLYOFFICE_JWT_SECRET — the same guarantee the
// onlyoffice-callback edge function enforces server-side, ported here verbatim
// in intent: verify, then read the acted-on fields out of the VERIFIED claims.
//
// HMAC is implemented directly on sha2 (RFC 2104 ipad/opad) rather than pulling
// in a new crate; it is ~15 lines and covered by the RFC 4231 vectors below.

/// Clock-skew allowance between the document server and this machine.
const ONLYOFFICE_JWT_CLOCK_SKEW_SEC: i64 = 120;

/// Hosts a callback `url` may resolve to for the relay to treat the save as
/// local and handle it in-process. Compared for HOST EQUALITY, never substring:
/// `http://evil.example/payload.docx?localhost` must not qualify, or the relay
/// becomes an SSRF-driven arbitrary-file-replacement primitive.
const LOCAL_CALLBACK_HOSTS: [&str; 4] = [
    "localhost",
    "127.0.0.1",
    "::1",
    "host.docker.internal",
];

/// HMAC-SHA256 (RFC 2104): H((K ^ opad) || H((K ^ ipad) || message)).
/// Keys longer than the 64-byte SHA-256 block are hashed first; shorter keys
/// are zero-padded to the block length.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK_LEN: usize = 64;

    let mut padded_key = [0u8; BLOCK_LEN];
    if key.len() > BLOCK_LEN {
        padded_key[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        padded_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36u8; BLOCK_LEN];
    let mut outer_pad = [0x5cu8; BLOCK_LEN];
    for i in 0..BLOCK_LEN {
        inner_pad[i] ^= padded_key[i];
        outer_pad[i] ^= padded_key[i];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);

    let mut mac = [0u8; 32];
    mac.copy_from_slice(&outer.finalize());
    mac
}

/// Length-independent, data-independent comparison. `==` on slices
/// short-circuits at the first differing byte, which leaks how much of a forged
/// MAC was correct to anyone able to time the response.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// base64url (RFC 4648 §5) decode. Padding is tolerated but not required — JWT
/// segments are unpadded. Standard-base64 `+` / `/` and whitespace are rejected
/// rather than silently remapped: a token that is not base64url is not a token
/// this verifier minted a signature over.
fn b64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3 + 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    // Leftover bits must be zero padding; anything else means the input was
    // truncated mid-byte.
    if bits > 0 && (acc & ((1u32 << bits) - 1)) != 0 {
        return None;
    }
    Some(out)
}

/// Decode one base64url JWT segment into a JSON **object**. Arrays and scalars
/// are rejected so downstream `.get(...)` lookups can never silently miss.
fn decode_jwt_segment(segment: &str) -> Option<serde_json::Value> {
    let bytes = b64url_decode(segment)?;
    let value = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
    if value.is_object() {
        Some(value)
    } else {
        None
    }
}

/// Verify one HS256 JWT against the shared secret and return its claims.
///
/// Hardening notes:
///  - `alg` is read from the header and REQUIRED to be HS256. Without that,
///    `{"alg":"none"}` (empty signature) verifies trivially, and an RS256
///    header invites key confusion.
///  - The MAC comparison is constant-time (see constant_time_eq).
///  - `exp`/`nbf` are enforced when present, with a small skew allowance. A
///    token with no `exp` is still accepted: the secret is the security
///    boundary, and document servers configured without `token.outbox.expires`
///    legitimately omit it.
fn verify_hs256(token: &str, secret: &str, now: i64) -> Option<serde_json::Value> {
    let mut parts = token.trim().split('.');
    let header_b64 = parts.next()?;
    let payload_b64 = parts.next()?;
    let signature_b64 = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if header_b64.is_empty() || payload_b64.is_empty() || signature_b64.is_empty() {
        return None;
    }

    let header = decode_jwt_segment(header_b64)?;
    let alg = header.get("alg").and_then(|v| v.as_str())?;
    if !alg.eq_ignore_ascii_case("HS256") {
        return None;
    }

    let signature = b64url_decode(signature_b64)?;
    let expected = hmac_sha256(
        secret.as_bytes(),
        format!("{header_b64}.{payload_b64}").as_bytes(),
    );
    if !constant_time_eq(&signature, &expected) {
        return None;
    }

    let claims = decode_jwt_segment(payload_b64)?;
    if let Some(exp) = claims.get("exp").and_then(json_i64) {
        if exp + ONLYOFFICE_JWT_CLOCK_SKEW_SEC < now {
            return None;
        }
    }
    if let Some(nbf) = claims.get("nbf").and_then(json_i64) {
        if nbf - ONLYOFFICE_JWT_CLOCK_SKEW_SEC > now {
            return None;
        }
    }
    Some(claims)
}

/// Unwrap the `{ "payload": { ...callback fields... } }` shape ONLYOFFICE uses
/// for the header token. The body token carries the fields at the top level.
fn unwrap_jwt_claims(claims: serde_json::Value) -> serde_json::Value {
    if let Some(inner) = claims.get("payload") {
        if inner.is_object() {
            return inner.clone();
        }
    }
    claims
}

/// Outcome of authenticating a relay callback.
enum CallbackAuth {
    /// Signature checked. Holds the SIGNED view of the callback — the only
    /// object the relay may act on.
    Verified(serde_json::Value),
    /// No ONLYOFFICE secret reachable from this process (see
    /// onlyoffice_jwt_secret): nothing can be verified, so nothing is trusted.
    NoSecret,
    /// Neither the configured header nor the body carried a token.
    NoToken,
    /// A token was present but no candidate verified.
    Invalid,
}

impl CallbackAuth {
    fn claims(&self) -> Option<&serde_json::Value> {
        match self {
            CallbackAuth::Verified(claims) => Some(claims),
            _ => None,
        }
    }

    fn reason(&self) -> &'static str {
        match self {
            CallbackAuth::Verified(_) => "verified",
            CallbackAuth::NoSecret => "no ONLYOFFICE JWT secret configured on this device",
            CallbackAuth::NoToken => "callback carried no ONLYOFFICE token",
            CallbackAuth::Invalid => "ONLYOFFICE token failed verification",
        }
    }
}

/// Authenticate a callback and return its SIGNED body.
///
/// The returned claims — not the raw request body — are what the relay acts on.
/// A signature only proves that *some* payload was minted by the document
/// server; reading `url` / `key` / `status` out of the unsigned envelope would
/// let anyone who captured one valid token replay it with a rewritten body and
/// have EasyVault download an arbitrary file and commit it over a vault
/// document. This mirrors verifyOnlyofficeToken() in the onlyoffice-callback
/// edge function.
///
/// Both token locations are tried, because which one survives depends on the
/// hop: the header may legitimately hold a NON-ONLYOFFICE token (the relay's
/// own Supabase JWT fallback when proxying), while the body token is the real
/// one — so a failure on the first candidate must not end the check.
fn verify_onlyoffice_callback(
    secret: Option<&str>,
    header_token: Option<&str>,
    body: &serde_json::Value,
    now: i64,
) -> CallbackAuth {
    let secret = match secret {
        Some(s) if !s.is_empty() => s,
        _ => return CallbackAuth::NoSecret,
    };

    let mut candidates: Vec<&str> = Vec::new();
    if let Some(token) = header_token.map(str::trim).filter(|t| !t.is_empty()) {
        candidates.push(token);
    }
    if let Some(token) = body
        .get("token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        candidates.push(token);
    }
    if candidates.is_empty() {
        return CallbackAuth::NoToken;
    }

    for candidate in candidates {
        if let Some(claims) = verify_hs256(candidate, secret, now) {
            return CallbackAuth::Verified(unwrap_jwt_claims(claims));
        }
    }
    CallbackAuth::Invalid
}

/// The ONLYOFFICE outbox-JWT secret, if this process can reach one.
///
/// Sources, highest priority first:
///  1. handed over by the frontend through `set_onlyoffice_relay_auth`
///     (`onlyofficeJwtSecret`) — the Settings-tab value, once the frontend
///     forwards it;
///  2. `EASYVAULT_ONLYOFFICE_JWT_SECRET`;
///  3. `ONLYOFFICE_JWT_SECRET` — the same name `ops/onlyoffice/.env` and both
///     docker-compose files already use, so local docker dev only has to export
///     the variable it already has.
///
/// `None` means callbacks cannot be authenticated, and the relay declines to
/// act on them (fail closed).
fn onlyoffice_jwt_secret() -> Option<String> {
    if let Some(secret) = get_relay_auth().and_then(|auth| auth.onlyoffice_jwt_secret) {
        return Some(secret);
    }
    for var in ["EASYVAULT_ONLYOFFICE_JWT_SECRET", "ONLYOFFICE_JWT_SECRET"] {
        if let Some(value) = std::env::var(var)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        {
            return Some(value);
        }
    }
    None
}

/// Header carrying the outbox token — `token.outbox.header`, default
/// `Authorization` (what both compose files configure).
fn onlyoffice_jwt_header_name() -> String {
    std::env::var("ONLYOFFICE_JWT_HEADER")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "Authorization".to_string())
}

/// Value prefix on that header — `token.outbox.prefix`, default `Bearer `.
fn onlyoffice_jwt_header_prefix() -> String {
    std::env::var("ONLYOFFICE_JWT_PREFIX").unwrap_or_else(|_| "Bearer ".to_string())
}

fn strip_token_prefix(value: &str, prefix: &str) -> String {
    let trimmed = value.trim();
    if !prefix.is_empty() {
        // `get` (not slicing) because a prefix length can land mid-character.
        if let Some(head) = trimmed.get(..prefix.len()) {
            if head.eq_ignore_ascii_case(prefix) {
                return trimmed[prefix.len()..].trim().to_string();
            }
        }
    }
    trimmed.to_string()
}

fn request_header_value(request: &tiny_http::Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Host of an absolute http(s) URL: lowercased, userinfo/port/IPv6 brackets
/// stripped, trailing dot removed. `None` for anything that is not an absolute
/// http(s) URL — a relative path or a `file:` URL has no host we may class as
/// loopback.
fn url_host(url: &str) -> Option<String> {
    let (scheme, rest) = url.trim().split_once("://")?;
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    // The authority ends at the first '/', '?' or '#'.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return None;
    }
    // `user:pass@host`. Split on the LAST '@': `http://a@b@evil.example/` has
    // host `evil.example`, not `b`.
    let host_port = match authority.rsplit_once('@') {
        Some((_userinfo, host)) => host,
        None => authority,
    };
    // IPv6 literals are bracketed: `[::1]:8080`.
    let host = if let Some(after_bracket) = host_port.strip_prefix('[') {
        after_bracket.split_once(']').map(|(h, _)| h)?
    } else {
        host_port.split(':').next().unwrap_or("")
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

/// Whether a callback `url` points at this machine. HOST EQUALITY — the old
/// `url.contains("localhost")` test also accepted
/// `http://evil.example/payload.docx?localhost`.
fn is_local_callback_url(url: &str) -> bool {
    match url_host(url) {
        Some(host) => LOCAL_CALLBACK_HOSTS.contains(&host.as_str()),
        None => false,
    }
}

fn respond_json(request: tiny_http::Request, status: u16, body: &str) {
    let mut response = Response::from_string(body).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", b"application/json") {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
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
    // key.get(..36) instead of key[..36]: byte-slicing panics when index 36 is
    // not a char boundary (keys can carry multi-byte chars, e.g. bidi isolates).
    if let Some(candidate) = key.get(..36) {
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

fn relay_bind_host() -> String {
    // Loopback by default: the in-app editor iframe talks to the relay via
    // http://localhost:17171, and Docker Desktop (macOS/Windows) forwards
    // host.docker.internal traffic to the host's loopback, so local docker dev
    // still works. The remote ONLYOFFICE server never calls the relay directly
    // — its callbacks go to the onlyoffice-callback edge function upstream.
    // Linux docker dev (host-gateway routes via the bridge, not loopback) can
    // opt back into 0.0.0.0 via EASYVAULT_ONLYOFFICE_RELAY_BIND.
    std::env::var("EASYVAULT_ONLYOFFICE_RELAY_BIND")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

#[tauri::command]
fn get_onlyoffice_relay_info() -> OnlyofficeRelayInfo {
    // container_callback_url is only handed to the ONLYOFFICE server when the
    // configured server URL is localhost-ish (see onlyofficeService.ts). With
    // the default loopback bind it stays reachable under Docker Desktop
    // (macOS/Windows), which delivers host.docker.internal via loopback; Linux
    // docker dev must set EASYVAULT_ONLYOFFICE_RELAY_BIND=0.0.0.0 for it to
    // resolve to a listening socket.
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
        // Bind loopback-only by default (see relay_bind_host for the rationale
        // and the EASYVAULT_ONLYOFFICE_RELAY_BIND escape hatch).
        let bind_addr = format!("{}:{port}", relay_bind_host());
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

        for request in server.incoming_requests() {
            // One thread per request: a slow save callback (download + chunked
            // upload) must not stall /editor or /editor-config for its duration.
            // Request is Send, reqwest::blocking::Client clones share one pool,
            // and all shared state lives behind OnceLock<Mutex<...>> statics.
            let client = client.clone();
            thread::spawn(move || handle_relay_request(request, client));
        }
    });
}

fn handle_relay_request(mut request: tiny_http::Request, client: reqwest::blocking::Client) {
            let path = request.url().to_string();
            let method = request.method().clone();

            if method == Method::Get && path == "/health" {
                let _ = request.respond(Response::from_string("ok"));
                return;
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
                return;
            }

            // ── /editor-config?id=XXX — return stored editor config JSON ──
            if method == Method::Get && path.starts_with("/editor-config") {
                let query_id = path.split("id=").nth(1).unwrap_or("").split('&').next().unwrap_or("");
                let config_json = if !query_id.is_empty() {
                    editor_config_store()
                        .lock()
                        .ok()
                        .and_then(|store| {
                            store
                                .iter()
                                .find(|(k, _)| k.as_str() == query_id)
                                .map(|(_, v)| v.clone())
                        })
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
                return;
            }

            if method != Method::Post || path != "/onlyoffice-callback" {
                let _ = request.respond(
                    Response::from_string("not found")
                        .with_status_code(StatusCode(404)),
                );
                return;
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
                return;
            }

            // ── Authenticate: nothing below acts on an unsigned callback ──
            //
            // A signature only proves that *some* payload was minted by the
            // document server, so every field the relay acts on (status / url /
            // key / users) is read out of the VERIFIED claims, never out of the
            // raw envelope. Otherwise a captured token replayed with a rewritten
            // body would still get an attacker's file committed over a vault
            // document — the same reasoning as the onlyoffice-callback edge
            // function.
            let header_token = request_header_value(&request, &onlyoffice_jwt_header_name())
                .map(|value| strip_token_prefix(&value, &onlyoffice_jwt_header_prefix()));
            let secret = onlyoffice_jwt_secret();
            let raw_json = serde_json::from_slice::<serde_json::Value>(&body).ok();
            let auth = match raw_json.as_ref() {
                Some(json) => verify_onlyoffice_callback(
                    secret.as_deref(),
                    header_token.as_deref(),
                    json,
                    unix_now(),
                ),
                None => CallbackAuth::NoToken,
            };

            if let Some(json) = raw_json.as_ref() {
                // Diagnostics mirror the signed view when there is one. An
                // unverified callback's fields are only ever echoed into stats
                // or used to decide that this request must be REFUSED.
                let view = auth.claims().unwrap_or(json);
                let status = view.get("status").and_then(parse_callback_status);
                let key = view
                    .get("key")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let callback_url = view
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if let Ok(mut stats) = relay_stats_store().lock() {
                    stats.callback_count = stats.callback_count.saturating_add(1);
                    stats.last_status = status;
                    stats.last_key = (!key.is_empty()).then(|| key.clone());
                    stats.last_upstream_body =
                        (!callback_url.is_empty()).then(|| callback_url.clone());
                    stats.last_error = None;
                }

                let is_save = matches!(status, Some(2) | Some(6));
                if is_save {
                    if let Ok(mut stats) = relay_stats_store().lock() {
                        stats.last_save_status = status;
                        stats.last_save_key = Some(key.clone());
                        stats.last_save_upstream_body = Some(callback_url.clone());
                        stats.last_save_error = None;
                        stats.last_save_commit_method = None;
                    }
                }

                // Handle local ONLYOFFICE save callbacks end-to-end in the relay.
                if is_save && !key.is_empty() && is_local_callback_url(&callback_url) {
                    // FAIL CLOSED: without a verified signature the relay
                    // downloads, uploads and commits nothing. Proxying such a
                    // callback upstream instead would be no safer and less
                    // honest — the edge function ACKs local-url callbacks on the
                    // assumption that this relay performs the save.
                    if auth.claims().is_none() {
                        let reason = auth.reason();
                        eprintln!("[onlyoffice-relay] REJECTED local save callback: {reason}");
                        if let Ok(mut stats) = relay_stats_store().lock() {
                            let message = format!("rejected unverified save callback: {reason}");
                            stats.last_error = Some(message.clone());
                            stats.last_save_error = Some(message);
                            stats.last_save_commit_method = Some("rejected_unverified".to_string());
                        }
                        respond_json(
                            request,
                            403,
                            r#"{"error":1,"message":"invalid or missing ONLYOFFICE signature"}"#,
                        );
                        return;
                    }

                    let users = view
                        .get("users")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                .collect::<Vec<String>>()
                        })
                        .unwrap_or_default();

                    handle_local_save(
                        request,
                        &client,
                        &key,
                        &callback_url,
                        &users,
                        status.unwrap_or(6),
                    );
                    return;
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


/// Perform a VERIFIED local ONLYOFFICE save end-to-end: download the edited
/// bytes, chunk-upload them to Supabase Storage, then commit a new version.
///
/// Every argument comes from claims that passed verify_onlyoffice_callback —
/// this function must never be reached with values read off an unsigned body,
/// because it publishes whatever `callback_url` serves as the new content of
/// the vault file named by `key`.
fn handle_local_save(
    request: tiny_http::Request,
    client: &reqwest::blocking::Client,
    key: &str,
    callback_url: &str,
    users: &[String],
    status: i64,
) {
    let auth = match get_relay_auth() {
        Some(a) => a,
        None => {
            if let Ok(mut stats) = relay_stats_store().lock() {
                stats.last_error = Some("missing relay auth token".to_string());
                stats.last_save_error = Some("missing relay auth token".to_string());
            }
            respond_json(request, 500, r#"{"error":1,"message":"missing relay auth"}"#);
            return;
        }
    };

    // host.docker.internal only resolves inside the container; from here the
    // same loopback socket answers on localhost. The host was already checked
    // for equality against LOCAL_CALLBACK_HOSTS, so this rewrite cannot retarget
    // the download somewhere else.
    let fetch_url = callback_url.replace("host.docker.internal", "localhost");
    let bytes = match client.get(&fetch_url).send() {
        Ok(response) => match response.bytes() {
            Ok(b) => b.to_vec(),
            Err(e) => {
                if let Ok(mut stats) = relay_stats_store().lock() {
                    stats.last_error = Some(format!("download bytes failed: {e}"));
                    stats.last_save_error = Some(format!("download bytes failed: {e}"));
                }
                respond_json(
                    request,
                    502,
                    r#"{"error":1,"message":"download bytes failed"}"#,
                );
                return;
            }
        },
        Err(e) => {
            if let Ok(mut stats) = relay_stats_store().lock() {
                stats.last_error = Some(format!("download failed: {e}"));
                stats.last_save_error = Some(format!("download failed: {e}"));
            }
            respond_json(request, 502, r#"{"error":1,"message":"download failed"}"#);
            return;
        }
    };

    let ext = infer_office_ext_from_callback_url(callback_url);
    let filename = format!("onlyoffice_{}.{}", key, ext);
    let upload_url = match upload_bytes_to_storage(client, &auth, &filename, &bytes) {
        Ok(url) => url,
        Err(err) => {
            if let Ok(mut stats) = relay_stats_store().lock() {
                stats.last_error = Some(err.clone());
                stats.last_save_error = Some(err.clone());
            }
            respond_json(request, 502, &format!(r#"{{"error":1,"message":"{}"}}"#, err));
            return;
        }
    };

    if let Err(commit_err) = call_onlyoffice_commit(
        client,
        &auth,
        key,
        status,
        users,
        &upload_url,
        bytes.len(),
    ) {
        let file_id_guess = extract_file_id_from_key(key).unwrap_or_default();
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
            respond_json(request, 200, r#"{"error":0}"#);
            return;
        } else {
            call_file_versions_fallback(client, &auth, &file_id_guess, &upload_url, &bytes)
        };

        if let Err(fallback_err) = fallback_res {
            // Print/export callbacks can reference transient/non-vault artifacts.
            // If both commit paths report file-not-found, acknowledge callback to
            // avoid ONLYOFFICE warning popups while preserving normal save strictness.
            if is_file_not_found_err(&commit_err) && is_file_not_found_err(&fallback_err) {
                if let Ok(mut stats) = relay_stats_store().lock() {
                    stats.last_error = None;
                    stats.last_commit_method = Some("skipped_file_not_found_callback".to_string());
                    stats.last_save_commit_method =
                        Some("skipped_file_not_found_callback".to_string());
                    stats.last_save_error = None;
                    stats.last_save_upstream_status = Some(200);
                    stats.last_save_upstream_body = Some(
                        "relay skipped commit on file-not-found callback (likely print/export)"
                            .to_string(),
                    );
                }
                respond_json(request, 200, r#"{"error":0}"#);
                return;
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
            respond_json(
                request,
                502,
                &format!(
                    r#"{{"error":1,"message":"onlyofficeCommit failed: {}; fallback failed: {}"}}"#,
                    commit_err, fallback_err
                ),
            );
            return;
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
            stats.last_save_commit_method = Some("fileVersions_fallback".to_string());
        }
        respond_json(request, 200, r#"{"error":0}"#);
        return;
    }

    if let Ok(mut stats) = relay_stats_store().lock() {
        stats.last_upstream_status = Some(200);
        stats.last_upstream_body = Some("relay committed via onlyofficeCommit".to_string());
        stats.last_error = None;
        stats.last_commit_method = Some("onlyofficeCommit".to_string());
        stats.last_save_upstream_status = Some(200);
        stats.last_save_upstream_body = Some("relay committed via onlyofficeCommit".to_string());
        stats.last_save_error = None;
        stats.last_save_commit_method = Some("onlyofficeCommit".to_string());
    }
    respond_json(request, 200, r#"{"error":0}"#);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_onlyoffice_callback_relay();
    let mut builder = tauri::Builder::default();
    // Must be the FIRST registered plugin. With the "deep-link" feature it
    // forwards easyvault:// URLs from a second launch (how Windows/Linux
    // deliver scheme clicks) to this instance's deep-link handler instead
    // of opening a duplicate app window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}));
    }
    builder
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
            store_onlyoffice_editor_config,
            get_cpu_arch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";
    const HEX24: &str = "5f2b8c9d0e1f2a3b4c5d6e7f";

    // ── parse_callback_status ──────────────────────────────────────────────

    #[test]
    fn parse_callback_status_accepts_integer() {
        assert_eq!(parse_callback_status(&serde_json::json!(2)), Some(2));
    }

    #[test]
    fn parse_callback_status_accepts_float() {
        assert_eq!(parse_callback_status(&serde_json::json!(6.0)), Some(6));
    }

    #[test]
    fn parse_callback_status_accepts_padded_string() {
        assert_eq!(parse_callback_status(&serde_json::json!(" 6 ")), Some(6));
    }

    #[test]
    fn parse_callback_status_rejects_null_and_garbage() {
        assert_eq!(parse_callback_status(&serde_json::Value::Null), None);
        assert_eq!(parse_callback_status(&serde_json::json!("abc")), None);
        assert_eq!(parse_callback_status(&serde_json::json!({})), None);
    }

    // ── infer_office_ext_from_callback_url ─────────────────────────────────

    #[test]
    fn infer_ext_strips_query_string() {
        assert_eq!(
            infer_office_ext_from_callback_url("http://h/file.xlsx?token=x&y=1"),
            "xlsx"
        );
    }

    #[test]
    fn infer_ext_is_case_insensitive() {
        assert_eq!(infer_office_ext_from_callback_url("http://h/DECK.PPTX"), "pptx");
    }

    #[test]
    fn infer_ext_defaults_to_docx() {
        assert_eq!(infer_office_ext_from_callback_url("http://h/file.bin"), "docx");
        assert_eq!(infer_office_ext_from_callback_url("http://h/noext"), "docx");
    }

    // ── is_uuid / is_hex_24 ────────────────────────────────────────────────

    #[test]
    fn is_uuid_accepts_valid_uuid() {
        assert!(is_uuid(UUID));
    }

    #[test]
    fn is_uuid_rejects_wrong_shape() {
        assert!(!is_uuid("0a1b2c3d-4e5f-6a7b-8c9d0-e1f2a3b4c5d")); // dash misplaced
        assert!(!is_uuid("za1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d")); // non-hex char
        assert!(!is_uuid("0a1b2c3d-4e5f")); // too short
        assert!(!is_uuid(""));
    }

    #[test]
    fn is_hex_24_accepts_and_rejects() {
        assert!(is_hex_24(HEX24));
        assert!(!is_hex_24(&HEX24[..23]));
        assert!(!is_hex_24("g".repeat(24).as_str()));
    }

    // ── extract_file_id_from_key ───────────────────────────────────────────

    #[test]
    fn extract_file_id_leading_uuid_key() {
        let key = format!("{UUID}_v3_1699999999");
        assert_eq!(extract_file_id_from_key(&key), Some(UUID.to_string()));
    }

    #[test]
    fn extract_file_id_legacy_hex24_key() {
        let key = format!("{HEX24}_v2_1699999999");
        assert_eq!(extract_file_id_from_key(&key), Some(HEX24.to_string()));
    }

    #[test]
    fn extract_file_id_embedded_uuid() {
        let key = format!("prefix-{UUID}-suffix");
        assert_eq!(extract_file_id_from_key(&key), Some(UUID.to_string()));
    }

    #[test]
    fn extract_file_id_bidi_wrapped_uuid_key() {
        // ONLYOFFICE keys observed wrapped in Unicode bidi isolate chars.
        let key = format!("\u{2068}{UUID}_v3_1699999999\u{2069}");
        assert_eq!(extract_file_id_from_key(&key), Some(UUID.to_string()));
    }

    #[test]
    fn extract_file_id_multibyte_boundary_does_not_panic() {
        // 35 ASCII chars + a 2-byte char: byte 36 is NOT a char boundary.
        // ('z' is not a hex digit, so no hex24/uuid window can match.)
        let key = format!("{}ä", "z".repeat(35));
        assert_eq!(extract_file_id_from_key(&key), None);
    }

    #[test]
    fn extract_file_id_garbage_returns_none() {
        assert_eq!(extract_file_id_from_key("not-a-file-key"), None);
        assert_eq!(extract_file_id_from_key(""), None);
    }

    // ── extract_upload_id / extract_file_url ───────────────────────────────

    #[test]
    fn extract_upload_id_top_level_and_nested() {
        assert_eq!(
            extract_upload_id(&serde_json::json!({"upload_id": "u1"})),
            Some("u1".to_string())
        );
        assert_eq!(
            extract_upload_id(&serde_json::json!({"data": {"upload_id": "u2"}})),
            Some("u2".to_string())
        );
        assert_eq!(extract_upload_id(&serde_json::json!({})), None);
    }

    #[test]
    fn extract_file_url_top_level_key() {
        let payload = serde_json::json!({"url": "https://h/f.docx"});
        assert_eq!(extract_file_url(&payload), Some("https://h/f.docx".to_string()));
    }

    #[test]
    fn extract_file_url_nested_data_file() {
        let payload = serde_json::json!({"data": {"file": {"download_url": "https://h/n.docx"}}});
        assert_eq!(extract_file_url(&payload), Some("https://h/n.docx".to_string()));
    }

    #[test]
    fn extract_file_url_ignores_empty_and_missing() {
        assert_eq!(extract_file_url(&serde_json::json!({"url": ""})), None);
        assert_eq!(extract_file_url(&serde_json::json!({})), None);
    }

    // ── is_file_not_found_err ──────────────────────────────────────────────

    #[test]
    fn file_not_found_needs_both_markers() {
        assert!(is_file_not_found_err("HTTP 404: File Not Found"));
        assert!(is_file_not_found_err(
            "onlyofficeCommit failed (404): {\"error\":\"file not found\"}"
        ));
        assert!(!is_file_not_found_err("HTTP 404: page missing"));
        assert!(!is_file_not_found_err("file not found (HTTP 500)"));
    }

    // ── random_session_id ──────────────────────────────────────────────────

    #[test]
    fn random_session_id_is_32_hex_chars_and_unique() {
        let a = random_session_id();
        let b = random_session_id();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    // ── sanitize_file_id / sanitize_filename ───────────────────────────────

    #[test]
    fn sanitize_file_id_strips_traversal_to_none() {
        assert_eq!(sanitize_file_id("../.."), None);
        assert_eq!(sanitize_file_id(""), None);
    }

    #[test]
    fn sanitize_file_id_keeps_uuid_like_ids() {
        assert_eq!(sanitize_file_id(UUID), Some(UUID.to_string()));
        assert_eq!(sanitize_file_id("../etc"), Some("etc".to_string()));
    }

    #[test]
    fn sanitize_filename_replaces_separators() {
        assert_eq!(
            sanitize_filename("a/b\\c:d.docx"),
            Some("a_b_c_d.docx".to_string())
        );
        assert_eq!(sanitize_filename("nul\0byte"), Some("nul_byte".to_string()));
    }

    #[test]
    fn sanitize_filename_rejects_blank_results() {
        assert_eq!(sanitize_filename("   "), None);
        assert_eq!(sanitize_filename(""), None);
    }

    // ── ONLYOFFICE callback authentication ─────────────────────────────────

    const SECRET: &str = "ev-oo-test-secret";
    /// Fixed "now" for deterministic exp/nbf assertions.
    const NOW: i64 = 1_700_000_000;

    /// base64url encode, unpadded — the inverse of b64url_decode. Test-only:
    /// production code never mints ONLYOFFICE tokens, it only verifies them.
    fn b64url_encode(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let triple = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = ((triple[0] as u32) << 16) | ((triple[1] as u32) << 8) | triple[2] as u32;
            let indexes = [(n >> 18) & 63, (n >> 12) & 63, (n >> 6) & 63, n & 63];
            for index in indexes.iter().take(chunk.len() + 1) {
                out.push(ALPHABET[*index as usize] as char);
            }
        }
        out
    }

    /// Mint a token the way an ONLYOFFICE document server would.
    fn sign_jwt(header: serde_json::Value, payload: serde_json::Value, secret: &str) -> String {
        let header_b64 = b64url_encode(header.to_string().as_bytes());
        let payload_b64 = b64url_encode(payload.to_string().as_bytes());
        let mac = hmac_sha256(
            secret.as_bytes(),
            format!("{header_b64}.{payload_b64}").as_bytes(),
        );
        format!("{header_b64}.{payload_b64}.{}", b64url_encode(&mac))
    }

    fn hs256(payload: serde_json::Value) -> String {
        sign_jwt(serde_json::json!({"alg": "HS256", "typ": "JWT"}), payload, SECRET)
    }

    fn save_body() -> serde_json::Value {
        serde_json::json!({
            "status": 2,
            "key": format!("{UUID}_v1"),
            "url": "http://localhost:8080/cache/files/doc.docx",
            "users": ["editor@example.com"],
        })
    }

    // ── hmac_sha256 (RFC 4231 vectors) ─────────────────────────────────────

    #[test]
    fn hmac_sha256_matches_rfc4231_case_one() {
        let mac = hmac_sha256(&[0x0b; 20], b"Hi There");
        assert_eq!(
            hex::encode(mac),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn hmac_sha256_matches_rfc4231_case_two() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(
            hex::encode(mac),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn hmac_sha256_hashes_keys_longer_than_the_block() {
        // RFC 4231 case 6 — exercises the >64-byte key branch.
        let mac = hmac_sha256(
            &[0xaa; 131],
            b"Test Using Larger Than Block-Size Key - Hash Key First",
        );
        assert_eq!(
            hex::encode(mac),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    // ── b64url_decode ──────────────────────────────────────────────────────

    #[test]
    fn b64url_decode_roundtrips_all_byte_lengths() {
        for len in 0..8usize {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 251) as u8).collect();
            assert_eq!(b64url_decode(&b64url_encode(&bytes)), Some(bytes));
        }
    }

    #[test]
    fn b64url_decode_rejects_standard_base64_and_whitespace() {
        assert_eq!(b64url_decode("ab+d"), None);
        assert_eq!(b64url_decode("ab/d"), None);
        assert_eq!(b64url_decode("ab d"), None);
    }

    // ── verify_hs256 ───────────────────────────────────────────────────────

    #[test]
    fn verify_hs256_accepts_a_valid_token() {
        let token = hs256(serde_json::json!({"status": 2, "key": "k"}));
        let claims = verify_hs256(&token, SECRET, NOW).expect("valid token must verify");
        assert_eq!(claims.get("key").and_then(|v| v.as_str()), Some("k"));
    }

    #[test]
    fn verify_hs256_rejects_a_tampered_payload() {
        let token = hs256(serde_json::json!({"status": 2, "url": "http://localhost/good.docx"}));
        let mut parts: Vec<&str> = token.split('.').collect();
        let forged_payload = b64url_encode(
            serde_json::json!({"status": 2, "url": "http://evil.example/bad.docx"})
                .to_string()
                .as_bytes(),
        );
        parts[1] = &forged_payload;
        assert_eq!(verify_hs256(&parts.join("."), SECRET, NOW), None);
    }

    #[test]
    fn verify_hs256_rejects_a_foreign_secret() {
        let token = sign_jwt(
            serde_json::json!({"alg": "HS256"}),
            serde_json::json!({"status": 2}),
            "attacker-secret",
        );
        assert_eq!(verify_hs256(&token, SECRET, NOW), None);
    }

    #[test]
    fn verify_hs256_rejects_alg_none() {
        // The classic bypass: correct claims, empty signature, "alg":"none".
        let header = b64url_encode(br#"{"alg":"none","typ":"JWT"}"#);
        let payload = b64url_encode(serde_json::json!({"status": 2}).to_string().as_bytes());
        assert_eq!(verify_hs256(&format!("{header}.{payload}."), SECRET, NOW), None);
        // ...and with a signature segment that is merely wrong rather than empty.
        assert_eq!(
            verify_hs256(&format!("{header}.{payload}.AAAA"), SECRET, NOW),
            None
        );
    }

    #[test]
    fn verify_hs256_rejects_non_hs256_algorithms() {
        // Key confusion: a token whose MAC is a valid HMAC over the secret but
        // which claims RS256 must not be accepted as an HS256 token.
        let token = sign_jwt(
            serde_json::json!({"alg": "RS256"}),
            serde_json::json!({"status": 2}),
            SECRET,
        );
        assert_eq!(verify_hs256(&token, SECRET, NOW), None);
    }

    #[test]
    fn verify_hs256_rejects_malformed_tokens() {
        assert_eq!(verify_hs256("", SECRET, NOW), None);
        assert_eq!(verify_hs256("only.two", SECRET, NOW), None);
        assert_eq!(verify_hs256("a.b.c.d", SECRET, NOW), None);
    }

    #[test]
    fn verify_hs256_honours_exp_within_clock_skew() {
        let fresh = hs256(serde_json::json!({"status": 2, "exp": NOW + 60}));
        assert!(verify_hs256(&fresh, SECRET, NOW).is_some());

        // Just inside the skew allowance — still accepted.
        let borderline = hs256(serde_json::json!({"status": 2, "exp": NOW - 60}));
        assert!(verify_hs256(&borderline, SECRET, NOW).is_some());

        let expired = hs256(serde_json::json!({"status": 2, "exp": NOW - 3600}));
        assert_eq!(verify_hs256(&expired, SECRET, NOW), None);
    }

    #[test]
    fn verify_hs256_rejects_tokens_not_yet_valid() {
        let future = hs256(serde_json::json!({"status": 2, "nbf": NOW + 3600}));
        assert_eq!(verify_hs256(&future, SECRET, NOW), None);

        let nearly_now = hs256(serde_json::json!({"status": 2, "nbf": NOW + 60}));
        assert!(verify_hs256(&nearly_now, SECRET, NOW).is_some());
    }

    // ── verify_onlyoffice_callback ─────────────────────────────────────────

    #[test]
    fn callback_auth_accepts_a_body_token() {
        let mut body = save_body();
        body["token"] = serde_json::json!(hs256(save_body()));
        let auth = verify_onlyoffice_callback(Some(SECRET), None, &body, NOW);
        let claims = auth.claims().expect("body token must verify");
        assert_eq!(claims.get("status").and_then(json_i64), Some(2));
    }

    #[test]
    fn callback_auth_accepts_a_header_token_and_unwraps_its_payload() {
        // The header token wraps the callback as { "payload": { ... } }.
        let token = hs256(serde_json::json!({"payload": save_body()}));
        let auth = verify_onlyoffice_callback(Some(SECRET), Some(&token), &save_body(), NOW);
        let claims = auth.claims().expect("header token must verify");
        assert_eq!(
            claims.get("url").and_then(|v| v.as_str()),
            Some("http://localhost:8080/cache/files/doc.docx")
        );
    }

    #[test]
    fn callback_auth_falls_through_to_the_body_token() {
        // The header can legitimately carry a NON-ONLYOFFICE token (the relay's
        // Supabase JWT fallback), so a first-candidate failure must not end the
        // check.
        let mut body = save_body();
        body["token"] = serde_json::json!(hs256(save_body()));
        let foreign = sign_jwt(
            serde_json::json!({"alg": "HS256"}),
            serde_json::json!({"sub": "supabase-user"}),
            "some-other-secret",
        );
        let auth = verify_onlyoffice_callback(Some(SECRET), Some(&foreign), &body, NOW);
        assert!(auth.claims().is_some());
    }

    #[test]
    fn callback_auth_returns_signed_claims_not_the_rewritten_envelope() {
        // Captured-token replay: valid token, attacker-rewritten body. The
        // relay must act on the SIGNED url, never the envelope's.
        let token = hs256(save_body());
        let forged = serde_json::json!({
            "status": 2,
            "key": format!("{UUID}_v1"),
            "url": "http://localhost:9/attacker-payload.docx",
            "token": token,
        });
        let auth = verify_onlyoffice_callback(Some(SECRET), None, &forged, NOW);
        let claims = auth.claims().expect("token itself is genuine");
        assert_eq!(
            claims.get("url").and_then(|v| v.as_str()),
            Some("http://localhost:8080/cache/files/doc.docx")
        );
    }

    #[test]
    fn callback_auth_fails_closed_without_a_secret() {
        let mut body = save_body();
        body["token"] = serde_json::json!(hs256(save_body()));
        assert!(verify_onlyoffice_callback(None, None, &body, NOW)
            .claims()
            .is_none());
        assert!(verify_onlyoffice_callback(Some(""), None, &body, NOW)
            .claims()
            .is_none());
        assert!(matches!(
            verify_onlyoffice_callback(None, None, &body, NOW),
            CallbackAuth::NoSecret
        ));
    }

    #[test]
    fn callback_auth_reports_a_missing_token() {
        let auth = verify_onlyoffice_callback(Some(SECRET), None, &save_body(), NOW);
        assert!(auth.claims().is_none());
        assert!(matches!(auth, CallbackAuth::NoToken));
    }

    #[test]
    fn callback_auth_rejects_a_forged_token() {
        let mut body = save_body();
        body["token"] = serde_json::json!(sign_jwt(
            serde_json::json!({"alg": "HS256"}),
            save_body(),
            "attacker-secret"
        ));
        let auth = verify_onlyoffice_callback(Some(SECRET), None, &body, NOW);
        assert!(auth.claims().is_none());
        assert!(matches!(auth, CallbackAuth::Invalid));
    }

    // ── strip_token_prefix ─────────────────────────────────────────────────

    #[test]
    fn strip_token_prefix_removes_bearer_case_insensitively() {
        assert_eq!(strip_token_prefix("Bearer abc.def.ghi", "Bearer "), "abc.def.ghi");
        assert_eq!(strip_token_prefix("bearer abc", "Bearer "), "abc");
        assert_eq!(strip_token_prefix("abc", "Bearer "), "abc");
        assert_eq!(strip_token_prefix("  abc  ", ""), "abc");
        // A prefix longer than the value must not panic or over-slice.
        assert_eq!(strip_token_prefix("hi", "Bearer "), "hi");
    }

    // ── url_host / is_local_callback_url ───────────────────────────────────

    #[test]
    fn url_host_strips_userinfo_port_and_brackets() {
        assert_eq!(url_host("http://localhost:8080/x"), Some("localhost".into()));
        assert_eq!(url_host("http://user:pw@127.0.0.1/x"), Some("127.0.0.1".into()));
        assert_eq!(url_host("http://a@b@evil.example/x"), Some("evil.example".into()));
        assert_eq!(url_host("http://[::1]:8080/x"), Some("::1".into()));
        assert_eq!(url_host("http://LOCALHOST./x"), Some("localhost".into()));
        assert_eq!(url_host("http://host.docker.internal"), Some("host.docker.internal".into()));
        assert_eq!(url_host("file:///etc/passwd"), None);
        assert_eq!(url_host("/relative/path"), None);
        assert_eq!(url_host("http:///nohost"), None);
    }

    #[test]
    fn local_callback_url_accepts_loopback_hosts() {
        assert!(is_local_callback_url("http://localhost:8080/cache/f.docx"));
        assert!(is_local_callback_url("http://127.0.0.1:8080/cache/f.docx"));
        assert!(is_local_callback_url("http://[::1]:8080/cache/f.docx"));
        assert!(is_local_callback_url("http://host.docker.internal:17171/f.docx"));
        assert!(is_local_callback_url("HTTP://LocalHost/f.docx"));
    }

    #[test]
    fn local_callback_url_rejects_substring_lookalikes() {
        // The bug this replaces: `url.contains("localhost")`.
        assert!(!is_local_callback_url("http://evil.example/payload.docx?localhost"));
        assert!(!is_local_callback_url("http://localhost.evil.example/payload.docx"));
        assert!(!is_local_callback_url("http://evil.example/localhost/payload.docx"));
        assert!(!is_local_callback_url("http://evil.example/#127.0.0.1"));
        assert!(!is_local_callback_url("http://user@evil.example/?host.docker.internal"));
        assert!(!is_local_callback_url("http://127.0.0.1.evil.example/f.docx"));
        assert!(!is_local_callback_url(""));
    }
}
