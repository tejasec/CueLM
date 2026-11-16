//! Provider catalogs, fetched without sending prompts or note data.
use futures::StreamExt;
use reqwest::{redirect::Policy, Client};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    time::Duration,
};

const MAX_RESPONSE: usize = 1024 * 1024;
const MAX_MODELS: usize = 2000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AiModel {
    pub id: String,
    pub name: String,
    /// None means the provider did not advertise the capability, not lack of support.
    pub vision: Option<bool>,
}

fn chat_candidate(id: &str) -> bool {
    let id = id.strip_prefix("ft:").unwrap_or(id);
    let family = id.starts_with("gpt-")
        || id.starts_with("chatgpt-")
        || id
            .strip_prefix('o')
            .is_some_and(|s| s.starts_with(|c: char| c.is_ascii_digit()));
    family
        && ![
            "realtime",
            "audio",
            "transcribe",
            "tts",
            "embedding",
            "image",
            "codex",
            "search",
            "moderation",
        ]
        .iter()
        .any(|kind| id.contains(kind))
}

fn parse_models(provider: &str, page: &Value) -> Result<Vec<AiModel>, String> {
    let data = page["data"]
        .as_array()
        .ok_or("Invalid model-list response")?;
    if data.len() > MAX_MODELS {
        return Err("Provider model list exceeds the limit".into());
    }
    let mut result = Vec::new();
    for item in data {
        let Some(id) = item["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 200 && !id.chars().any(char::is_control))
        else {
            continue;
        };
        if item["lifecycle"] == "retired" || (provider == "openai" && !chat_candidate(id)) {
            continue;
        }
        let name = item["display_name"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 200 && !s.chars().any(char::is_control))
            .unwrap_or(id);
        result.push(AiModel {
            id: id.into(),
            name: name.into(),
            vision: item["capabilities"]["image_input"]["supported"].as_bool(),
        });
    }
    Ok(result)
}

pub async fn fetch_models(provider: &str, key: &str) -> Result<Vec<AiModel>, String> {
    let url = match provider {
        "openai" => "https://api.openai.com/v1/models",
        "anthropic" => "https://api.anthropic.com/v1/models",
        _ => return Err("Model discovery supports OpenAI and Anthropic".into()),
    };
    let client = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not initialize model discovery")?;
    fetch_at(&client, provider, key.trim(), url).await
}

async fn fetch_at(
    client: &Client,
    provider: &str,
    key: &str,
    url: &str,
) -> Result<Vec<AiModel>, String> {
    if key.is_empty() {
        return Err("Enter an API key before fetching models".into());
    }
    if key.len() > 8192 {
        return Err("API key exceeds the length limit".into());
    }
    let mut cursor: Option<String> = None;
    let mut cursors = HashSet::new();
    let mut models = BTreeMap::new();
    for _ in 0..20 {
        let mut request = client.get(url);
        if provider == "anthropic" {
            request = request
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .query(&[("limit", "100")]);
            if let Some(after) = &cursor {
                request = request.query(&[("after_id", after)]);
            }
        } else {
            request = request.bearer_auth(key);
        }
        // Never return provider bodies or reqwest's debug representation: invalid-key
        // responses can echo credentials. Fixed endpoints and no redirects keep keys scoped.
        let response = request
            .send()
            .await
            .map_err(|_| "Could not reach the provider model catalog")?;
        if !response.status().is_success() {
            return Err(format!(
                "Model catalog returned HTTP {}. Check the API key and account permissions.",
                response.status().as_u16()
            ));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Could not read the provider model catalog")?;
            if bytes.len() + chunk.len() > MAX_RESPONSE {
                return Err("Provider model list exceeds the size limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let page: Value =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid model-list response")?;
        for model in parse_models(provider, &page)? {
            models.insert(model.id.clone(), model);
        }
        if models.len() > MAX_MODELS {
            return Err("Provider model list exceeds the limit".into());
        }
        if provider != "anthropic" || page["has_more"] != true {
            let mut result: Vec<_> = models.into_values().collect();
            result.sort_by_cached_key(|m| (m.name.to_lowercase(), m.id.clone()));
            return Ok(result);
        }
        let next = page["last_id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 200)
            .ok_or("Provider pagination cursor is missing")?
            .to_string();
        if !cursors.insert(next.clone()) {
            return Err("Provider repeated its pagination cursor".into());
        }
        cursor = Some(next);
    }
    Err("Provider model catalog has too many pages".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};

    #[test]
    fn openai_filters_non_chat_families_without_freezing_model_versions() {
        let result = parse_models("openai", &json!({"data":[
            {"id":"gpt-99-next"},{"id":"o12"},{"id":"ft:gpt-4o:org:custom"},
            {"id":"gpt-image-1"},{"id":"gpt-4o-realtime-preview"},{"id":"text-embedding-3-small"},
            {"id":"gpt-5-codex"},{"id":"gpt-audio"},{"id":"whisper-1"}
        ]})).unwrap();
        assert_eq!(
            result.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["gpt-99-next", "o12", "ft:gpt-4o:org:custom"]
        );
        assert!(result.iter().all(|m| m.vision.is_none()));
    }

    #[test]
    fn anthropic_preserves_reported_capability_and_excludes_retired_models() {
        let result = parse_models("anthropic", &json!({"data":[
            {"id":"claude-future","display_name":"Future Claude","capabilities":{"image_input":{"supported":true}}},
            {"id":"claude-old","lifecycle":"retired"},{"id":"claude-legacy"}
        ]})).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].vision, Some(true));
        assert_eq!(result[1].vision, None);
        assert!(parse_models("openai", &json!({"unexpected":[]})).is_err());
    }

    #[tokio::test]
    async fn paginates_with_scoped_headers_and_deduplicates_ids() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/models", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for (i, body) in [
                r#"{"data":[{"id":"claude-a"}],"has_more":true,"last_id":"claude-a"}"#,
                r#"{"data":[{"id":"claude-a"},{"id":"claude-b"}],"has_more":false}"#,
            ]
            .into_iter()
            .enumerate()
            {
                let (mut socket, _) = listener.accept().unwrap();
                let mut bytes = [0; 8192];
                let count = socket.read(&mut bytes).unwrap();
                let request = String::from_utf8_lossy(&bytes[..count]);
                assert!(request.contains("x-api-key: fake-key"));
                assert!(!request.contains("authorization:"));
                if i == 1 {
                    assert!(request.contains("after_id=claude-a"));
                }
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });
        let result = fetch_at(&Client::new(), "anthropic", "fake-key", &url)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn authentication_failures_do_not_echo_keys() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/models", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = [0; 4096];
            let _ = socket.read(&mut bytes);
            let body = "secret-key-should-not-appear";
            write!(
                socket,
                "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let error = fetch_at(
            &Client::builder().redirect(Policy::none()).build().unwrap(),
            "openai",
            "secret-key-should-not-appear",
            &url,
        )
        .await
        .unwrap_err();
        assert!(error.contains("401"));
        assert!(!error.contains("secret-key"));
        server.join().unwrap();
    }
}
