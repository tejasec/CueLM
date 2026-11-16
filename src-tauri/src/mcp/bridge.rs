use super::{
    notes,
    policy::{Access, Connection},
    Core,
};
use hmac::{Hmac, Mac};
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    body::{Bytes, Incoming},
    server::conn::http1,
    service::service_fn,
    Method, Request, Response, StatusCode,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::{json, Value};
use sha2::Sha256;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::Manager;

type Hmac256 = Hmac<Sha256>;
const MAX_HTTP: usize = 8 * 1024 * 1024;
pub struct Listener {
    pub endpoint: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Listener {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub fn signature(secret: &str, domain: &str, nonce: &str, data: &[u8]) -> String {
    let mut mac = Hmac256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(domain.as_bytes());
    mac.update(b"\0");
    mac.update(nonce.as_bytes());
    mac.update(b"\0");
    mac.update(data);
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
#[allow(clippy::chunks_exact_to_as_chunks)]
fn verify(secret: &str, domain: &str, nonce: &str, data: &[u8], given: &str) -> bool {
    if given.len() != 64 || !given.is_ascii() {
        return false;
    }
    let Ok(bytes) = given
        .as_bytes()
        .chunks_exact(2)
        .map(|part| u8::from_str_radix(std::str::from_utf8(part).unwrap_or(""), 16))
        .collect::<Result<Vec<_>, _>>()
    else {
        return false;
    };
    let mut mac = Hmac256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(domain.as_bytes());
    mac.update(b"\0");
    mac.update(nonce.as_bytes());
    mac.update(b"\0");
    mac.update(data);
    mac.verify_slice(&bytes).is_ok()
}

pub async fn start<R: tauri::Runtime>(core: Arc<Core<R>>) -> Result<Listener, String> {
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "Could not start the local MCP connection.")?;
    let address = listener
        .local_addr()
        .map_err(|_| "MCP address is unavailable.")?;
    let endpoint = format!("http://{address}/v1/mcp");
    let host = address.to_string();
    let permits = Arc::new(tokio::sync::Semaphore::new(16));
    let task = tokio::spawn(async move {
        let mut connections = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                accepted=listener.accept()=>{
                    let Ok((socket,peer))=accepted else{break;};if !peer.ip().is_loopback(){continue;}
                    let Ok(permit)=permits.clone().try_acquire_owned() else{continue;};let core=core.clone();let host=host.clone();
                    connections.spawn(async move{
                        let _permit=permit;
                        let service=service_fn(move|request|handle(core.clone(),host.clone(),request));
                        let _=http1::Builder::new().max_buf_size(8192).keep_alive(false).max_headers(32).timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(5)).serve_connection(TokioIo::new(socket),service).await;
                    });
                },
                _=connections.join_next(),if !connections.is_empty()=>{},
            }
        }
    });
    Ok(Listener { endpoint, task })
}

fn response(status: StatusCode, body: Value, auth: Option<(&str, &str)>) -> Response<Full<Bytes>> {
    let bytes = serde_json::to_vec(&body).unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if let Some((secret, nonce)) = auth {
        response = response.header(
            "X-Helix-Signature",
            signature(
                secret,
                &format!("response:{}", status.as_u16()),
                nonce,
                &bytes,
            ),
        );
    }
    response
        .body(Full::new(Bytes::from(bytes)))
        .expect("fixed response headers are valid")
}

async fn handle<R: tauri::Runtime>(
    core: Arc<Core<R>>,
    host: String,
    request: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    let deny = |status, error| response(status, json!({"ok":false,"error":error}), None);
    if request.method() != Method::POST
        || request.uri().path() != "/v1/mcp"
        || request.uri().query().is_some()
    {
        return Ok(deny(StatusCode::NOT_FOUND, "Unknown local endpoint."));
    }
    if request.headers().contains_key("origin")
        || request
            .headers()
            .get("host")
            .and_then(|value| value.to_str().ok())
            != Some(host.as_str())
        || request
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            != Some("application/json")
    {
        return Ok(deny(
            StatusCode::FORBIDDEN,
            "Browser and cross-origin access is not allowed.",
        ));
    }
    let auth = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .strip_prefix("Helix ")
        .unwrap_or("")
        .to_string();
    let parts: Vec<_> = auth.split(':').collect();
    if parts.len() != 4
        || parts[0].len() != 32
        || parts[2].len() != 32
        || !parts[0].bytes().all(|byte| byte.is_ascii_hexdigit())
        || !parts[2].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Ok(deny(
            StatusCode::UNAUTHORIZED,
            "MCP authorization is required.",
        ));
    }
    let (id, time, nonce, given) = (parts[0], parts[1], parts[2], parts[3]);
    let now = core.clock.0 + core.clock.1.elapsed().as_secs() as i64;
    if time
        .parse::<i64>()
        .ok()
        .is_none_or(|time| now.abs_diff(time) > 30)
    {
        return Ok(deny(
            StatusCode::UNAUTHORIZED,
            "MCP clock changed. Restart HelixNotes and reconnect.",
        ));
    }
    {
        let grants = core.grants.read().await;
        if !grants
            .iter()
            .any(|grant| grant.id == id && grant.mode != Access::Off)
        {
            return Ok(deny(StatusCode::UNAUTHORIZED, "MCP access is disabled."));
        }
    }
    let bytes = match tokio::time::timeout(
        Duration::from_secs(10),
        Limited::new(request.into_body(), MAX_HTTP).collect(),
    )
    .await
    {
        Ok(Ok(body)) => body.to_bytes(),
        _ => {
            return Ok(deny(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Invalid or oversized MCP request.",
            ))
        }
    };
    let grants = core.grants.clone().read_owned().await;
    let Some(grant) = grants
        .iter()
        .find(|grant| grant.id == id && grant.mode != Access::Off)
        .cloned()
    else {
        return Ok(deny(StatusCode::UNAUTHORIZED, "MCP access is disabled."));
    };
    let request_nonce = format!("{id}:{time}:{nonce}");
    if !verify(&grant.secret, "request", &request_nonce, &bytes, given) {
        return Ok(deny(StatusCode::UNAUTHORIZED, "Invalid MCP authorization."));
    }
    let accepted = core
        .nonces
        .lock()
        .map(|mut seen| {
            seen.retain(|(_, at)| at.elapsed() < Duration::from_secs(65));
            if seen.len() >= 4096 || seen.iter().any(|(previous, _)| previous == &request_nonce) {
                false
            } else {
                seen.push((request_nonce.clone(), Instant::now()));
                true
            }
        })
        .unwrap_or(false);
    if !accepted {
        return Ok(response(
            StatusCode::TOO_MANY_REQUESTS,
            json!({"ok":false,"error":"Duplicate request or rate limit reached. Retry shortly."}),
            Some((&grant.secret, &request_nonce)),
        ));
    }
    let body: Value = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(_) => {
            return Ok(response(
                StatusCode::BAD_REQUEST,
                json!({"ok":false,"error":"Invalid JSON request."}),
                Some((&grant.secret, &request_nonce)),
            ))
        }
    };
    let action = body.get("action").and_then(Value::as_str).unwrap_or("");
    let args = body.get("args").cloned().unwrap_or_else(|| json!({}));
    let result = if action == "edit_note" {
        if grant.mode != Access::Write {
            Err("Editing is disabled for this vault.".into())
        } else {
            let edit = serde_json::from_value(args)
                .map_err(|_| "Invalid focused edit arguments.".to_string());
            drop(grants);
            match edit {
                Ok(edit) => {
                    let core = core.clone();
                    let id = grant.id.clone();
                    let generation = grant.secret.clone();
                    tokio::spawn(async move { core.edit(id, generation, edit).await })
                        .await
                        .map_err(|_| "Native edit worker failed.".to_string())
                        .and_then(|result| result)
                }
                Err(error) => Err(error),
            }
        }
    } else {
        let state = core.app.state::<crate::state::AppState>();
        let _transition = state.vault_transition.lock().await;
        let valid = match state.config.lock() {
            Ok(config) => grant.validate(&config),
            Err(_) => Err("Config is unavailable.".into()),
        };
        if let Err(error) = valid {
            Err(error)
        } else {
            let grant = grant.clone();
            let action = action.to_string();
            tauri::async_runtime::spawn_blocking(move||match action.as_str(){
            "health"=>Ok(json!({"mode":grant.mode})),
            "list_notes"=>notes::list(&grant,&args,false),
            "search_notes"=>notes::list(&grant,&args,true),
            "read_note"=>notes::read(&grant,&args),
            "validate_note"=>{let markdown=notes::string(&args,"markdown")?;if markdown.len()>notes::MAX_NOTE{return Err("Markdown exceeds 2 MiB.".into());}Ok(json!({"applied":false,"frontmatter":notes::inspect(markdown,"Untitled.md")}))},
            _=>Err("Unknown MCP operation.".into()),
        }).await.map_err(|_|"Native read worker failed.".to_string()).and_then(|result|result)
        }
    };
    Ok(match result {
        Ok(result) => response(
            StatusCode::OK,
            json!({"ok":true,"result":result}),
            Some((&grant.secret, &request_nonce)),
        ),
        Err(error) => response(
            StatusCode::CONFLICT,
            json!({"ok":false,"error":error}),
            Some((&grant.secret, &request_nonce)),
        ),
    })
}

/// Secrets never travel over HTTP. Requests and responses are independently MACed;
/// an offline/stale port cannot impersonate HelixNotes or capture a bearer token.
pub async fn call(connection: &Connection, action: &str, args: Value) -> Result<Value, String> {
    if connection.version != 1
        || connection.mode == Access::Off
        || connection.secret.len() != 64
        || connection.id.len() != 32
    {
        return Err("Enable MCP access in HelixNotes Settings → Integrations.".into());
    }
    let url = reqwest::Url::parse(&connection.endpoint).map_err(|_| "Invalid local connection.")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/v1/mcp"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("MCP connections must use the local HelixNotes endpoint.".into());
    }
    let nonce = format!(
        "{}:{}:{}",
        connection.id,
        chrono::Utc::now().timestamp(),
        uuid::Uuid::new_v4().simple()
    );
    let bytes = serde_json::to_vec(&json!({"action":action,"args":args}))
        .map_err(|_| "Invalid MCP arguments.")?;
    if bytes.len() > MAX_HTTP {
        return Err("MCP request is too large.".into());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "Could not initialize the local connection.")?;
    let response=client.post(url).header("Content-Type","application/json").header("Authorization",format!("Helix {nonce}:{}",signature(&connection.secret,"request",&nonce,&bytes))).body(bytes).send().await.map_err(|_|"HelixNotes must be running. Open the app and enable this vault in Settings → Integrations.")?;
    let status = response.status().as_u16();
    let proof = response
        .headers()
        .get("X-Helix-Signature")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mut response = response;
    let mut data = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The local connection was interrupted.")?
    {
        if data.len() + chunk.len() > MAX_HTTP {
            return Err("MCP response is too large.".into());
        }
        data.extend_from_slice(&chunk);
    }
    if !verify(
        &connection.secret,
        &format!("response:{status}"),
        &nonce,
        &data,
        &proof,
    ) {
        return Err("The local connection is unavailable or access changed. Reconnect using HelixNotes Settings → Integrations.".into());
    }
    let response: Value = serde_json::from_slice(&data).map_err(|_| "Invalid local response.")?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("MCP operation failed.")
            .to_string());
    }
    Ok(response["result"].clone())
}
