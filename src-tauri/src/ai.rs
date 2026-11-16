use reqwest::Client;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::types::AiStreamEvent;
pub mod images;
pub mod models;
use images::AiImage;
mod sse;
mod stream;

async fn receive_stream(
    app: &AppHandle,
    response: reqwest::Response,
    request_id: &str,
    protocol: stream::Protocol,
) -> Result<(), String> {
    stream::receive(response, protocol, |text| {
        let _ = app.emit(
            "ai-stream",
            AiStreamEvent {
                request_id: request_id.to_owned(),
                event_type: "text".into(),
                text: Some(text),
                error: None,
            },
        );
    })
    .await?;
    // This is the only success event; errors are emitted once by ai_request.
    let _ = app.emit(
        "ai-stream",
        AiStreamEvent {
            request_id: request_id.to_owned(),
            event_type: "done".into(),
            text: None,
            error: None,
        },
    );
    Ok(())
}

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";
const OLLAMA_DEFAULT_URL: &str = "http://localhost:11434";

fn request_client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|_| "Could not initialize AI connection".into())
}

fn connection_error(_: reqwest::Error) -> String {
    // reqwest errors may contain configured URLs, including credentials or query secrets.
    "AI connection failed. Check the connection and configured server.".into()
}

fn http_error(status: reqwest::StatusCode) -> String {
    let hint = match status.as_u16() {
        401 | 403 => "Check the API key and account permissions.",
        429 => "Check rate limits and account quota.",
        400 | 404 => "Check the model ID and its support for this request, including images.",
        _ => "The provider or configured server could not complete the request.",
    };
    // Error bodies can echo credentials or image data. Do not broadcast them.
    format!("AI API returned HTTP {}. {hint}", status.as_u16())
}

#[allow(clippy::too_many_arguments)]
pub fn ai_request(
    app: AppHandle,
    provider: String,
    api_key: String,
    model: String,
    system_prompt: String,
    user_message: String,
    request_id: String,
    base_url: Option<String>,
    images: Vec<AiImage>,
) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Handle all API keys as optional; ollama and v1 completions doesnt always require it.
            let key_opt = if api_key.is_empty() {
                None
            } else {
                Some(api_key.as_str())
            };
            let result = match provider.as_str() {
                "openai" => {
                    stream_openai(
                        &app,
                        OPENAI_API_URL,
                        Some(&api_key),
                        &model,
                        &system_prompt,
                        &user_message,
                        &request_id,
                        &images,
                    )
                    .await
                }
                "ollama" => {
                    let url = base_url.as_deref().unwrap_or(OLLAMA_DEFAULT_URL);
                    let url = format!("{}/v1/chat/completions", url.trim_end_matches('/'));
                    stream_openai(
                        &app,
                        &url,
                        key_opt,
                        &model,
                        &system_prompt,
                        &user_message,
                        &request_id,
                        &images,
                    )
                    .await
                }
                "openai_compatible" => {
                    let url = base_url.as_deref().unwrap_or("");
                    if url.is_empty() {
                        Err("No base URL configured for OpenAI Compatible provider".to_string())
                    } else {
                        let url = format!("{}/v1/chat/completions", normalize_openai_base(url));
                        stream_openai(
                            &app,
                            &url,
                            key_opt,
                            &model,
                            &system_prompt,
                            &user_message,
                            &request_id,
                            &images,
                        )
                        .await
                    }
                }
                _ => {
                    stream_anthropic(
                        &app,
                        &api_key,
                        &model,
                        &system_prompt,
                        &user_message,
                        &request_id,
                        &images,
                    )
                    .await
                }
            };
            if let Err(e) = result {
                let _ = app.emit(
                    "ai-stream",
                    AiStreamEvent {
                        request_id: request_id.clone(),
                        event_type: "error".to_string(),
                        text: None,
                        error: Some(e),
                    },
                );
            }
        });
    });
}

/// Normalize an OpenAI-compatible base URL: drop a trailing slash and a trailing `/v1`,
/// so both `https://host` and `https://host/v1` work (we append `/v1/chat/completions`).
fn normalize_openai_base(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    b.strip_suffix("/v1")
        .unwrap_or(b)
        .trim_end_matches('/')
        .to_string()
}

fn openai_request_body(
    model: &str,
    system_prompt: Option<&str>,
    user_message: &str,
    stream: bool,
    max_tokens: u32,
) -> serde_json::Value {
    // GPT-5/6 reject legacy output limits and sampling with their default reasoning.
    let family = model.strip_prefix("ft:").unwrap_or(model);
    let reasoning = family
        .strip_prefix("gpt-")
        .and_then(|s| s.split(['.', '-']).next()?.parse::<u32>().ok())
        .is_some_and(|version| version >= 5)
        || family
            .strip_prefix('o')
            .is_some_and(|s| s.starts_with(|c: char| c.is_ascii_digit()));
    let token_key = if reasoning {
        "max_completion_tokens"
    } else {
        "max_tokens"
    };
    let mut messages = Vec::with_capacity(if system_prompt.is_some() { 2 } else { 1 });
    if let Some(system) = system_prompt {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.push(json!({ "role": "user", "content": user_message }));
    let mut body =
        json!({ "model": model, "stream": stream, token_key: max_tokens, "messages": messages });
    if stream && !reasoning {
        body["temperature"] = json!(0.7);
    }
    body
}

fn user_content(provider: &str, text: &str, images: &[AiImage]) -> serde_json::Value {
    if images.is_empty() {
        return json!(text);
    }
    let mut blocks = vec![json!({"type":"text","text":text})];
    for image in images {
        if provider == "anthropic" {
            blocks.push(json!({"type":"image","source":{"type":"base64","media_type":image.media_type,"data":image.data}}));
        } else {
            blocks.push(json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",image.media_type,image.data)}}));
        }
    }
    json!(blocks)
}

#[allow(clippy::too_many_arguments)]
async fn stream_anthropic(
    app: &AppHandle,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
    request_id: &str,
    images: &[AiImage],
) -> Result<(), String> {
    let client = request_client()?;

    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "stream": true,
        "system": system_prompt,
        "messages": [
            {
                "role": "user",
                "content": user_content("anthropic", user_message, images)
            }
        ]
    });

    let response = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(connection_error)?;

    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }

    receive_stream(app, response, request_id, stream::Protocol::Anthropic).await
}

#[allow(clippy::too_many_arguments)]
async fn stream_openai(
    app: &AppHandle,
    url: &str,
    api_key: Option<&str>,
    model: &str,
    system_prompt: &str,
    user_message: &str,
    request_id: &str,
    images: &[AiImage],
) -> Result<(), String> {
    let client = request_client()?;

    let mut body = openai_request_body(model, Some(system_prompt), user_message, true, 4096);
    body["messages"][1]["content"] = user_content("openai", user_message, images);

    let mut req = client.post(url).header("content-type", "application/json");

    if let Some(key) = api_key {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let response = req.json(&body).send().await.map_err(connection_error)?;

    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }

    receive_stream(app, response, request_id, stream::Protocol::OpenAi).await
}

pub async fn test_connection(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<String, String> {
    let key_opt = if api_key.is_empty() {
        None
    } else {
        Some(api_key)
    };
    match provider {
        "openai" => test_openai(OPENAI_API_URL, Some(api_key), model).await,
        "ollama" => {
            let url = base_url.unwrap_or(OLLAMA_DEFAULT_URL);
            let url = format!("{}/v1/chat/completions", url.trim_end_matches('/'));
            test_openai(&url, key_opt, model).await
        }
        "openai_compatible" => {
            let url = base_url.unwrap_or("");
            if url.is_empty() {
                return Err("No base URL configured for OpenAI Compatible provider".to_string());
            }
            let url = format!("{}/v1/chat/completions", normalize_openai_base(url));
            test_openai(&url, key_opt, model).await
        }
        _ => test_anthropic(api_key, model).await,
    }
}

async fn test_anthropic(api_key: &str, model: &str) -> Result<String, String> {
    let client = request_client()?;

    let body = json!({
        "model": model,
        "max_tokens": 20,
        "messages": [
            {
                "role": "user",
                "content": "Hi"
            }
        ]
    });

    let response = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(connection_error)?;

    if response.status().is_success() {
        Ok("Connection successful".to_string())
    } else {
        Err(http_error(response.status()))
    }
}

async fn test_openai(url: &str, api_key: Option<&str>, model: &str) -> Result<String, String> {
    let client = request_client()?;
    let body = openai_request_body(model, None, "Hi", false, 20);

    let mut req = client.post(url).header("content-type", "application/json");

    if let Some(key) = api_key {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let response = req.json(&body).send().await.map_err(connection_error)?;

    if response.status().is_success() {
        Ok("Connection successful".to_string())
    } else {
        Err(http_error(response.status()))
    }
}

#[cfg(test)]
mod request_tests {
    use super::*;

    #[test]
    fn vision_blocks_are_provider_specific_and_text_only_stays_a_string() {
        assert_eq!(user_content("openai", "Text only", &[]), json!("Text only"));
        let images = vec![AiImage {
            media_type: "image/png",
            data: "PIXELS".into(),
        }];
        let openai = user_content("openai", "Describe", &images);
        assert_eq!(
            openai[1]["image_url"]["url"],
            "data:image/png;base64,PIXELS"
        );
        let anthropic = user_content("anthropic", "Describe", &images);
        assert_eq!(anthropic[1]["source"]["type"], "base64");
        assert_eq!(anthropic[1]["source"]["media_type"], "image/png");
        assert_eq!(anthropic[1]["source"]["data"], "PIXELS");
    }

    #[test]
    fn connection_and_http_errors_never_include_urls_or_provider_payloads() {
        let url =
            reqwest::Url::parse("https://user:private-password@example.invalid/?key=private-key")
                .unwrap();
        let error = Client::new()
            .get("not a URL")
            .build()
            .unwrap_err()
            .with_url(url);
        assert!(error.to_string().contains("private-key"));
        let safe = connection_error(error);
        assert!(!safe.contains("private"));
        assert!(!safe.contains("example.invalid"));
        for code in [400, 401, 403, 404, 429, 500] {
            let safe = http_error(reqwest::StatusCode::from_u16(code).unwrap());
            assert!(safe.contains(&code.to_string()));
            assert!(safe.len() < 256);
        }
    }

    #[test]
    fn future_gpt_and_reasoning_ids_use_modern_output_limits() {
        for model in ["gpt-99-next", "o3", "o12-mini"] {
            let body = openai_request_body(model, None, "Hi", true, 4096);
            assert!(body.get("max_completion_tokens").is_some());
            assert!(body.get("temperature").is_none());
        }
    }

    #[test]
    fn gpt6_streaming_requests_use_supported_parameters() {
        let body = openai_request_body(
            "gpt-6-astra",
            Some("Return Markdown"),
            "Revise this",
            true,
            4096,
        );
        assert_eq!(body["max_completion_tokens"], 4096);
        assert!(body.get("max_tokens").is_none());
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn prior_openai_and_local_models_keep_their_parameter_contract() {
        let prior = openai_request_body("gpt-5.5", None, "Hi", false, 20);
        assert!(prior.get("max_completion_tokens").is_some());
        assert!(prior.get("max_tokens").is_none());
        let local = openai_request_body(
            "gemma3:4b",
            Some("Return Markdown"),
            "Revise this",
            true,
            4096,
        );
        assert_eq!(local["max_tokens"], 4096);
        assert_eq!(local["temperature"], 0.7);
        assert!(local.get("max_completion_tokens").is_none());
    }
}
