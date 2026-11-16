use super::*;
use serde_json::json;
use std::io::{Read, Write};

fn data(value: Value) -> String {
    format!("data: {value}\n\n")
}

fn openai_text(text: &str) -> String {
    data(json!({"choices":[{"index":0,"delta":{"content":text},"finish_reason":null}]}))
}

fn openai_stop(reason: &str) -> String {
    data(json!({"choices":[{"index":0,"delta":{},"finish_reason":reason}]}))
}

fn anthropic_text(text: &str) -> String {
    data(json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}))
}

fn anthropic_stop(reason: &str) -> String {
    data(
        json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":10}}),
    )
}

fn anthropic_done() -> String {
    data(json!({"type":"message_stop"}))
}

async fn request(body: &str, protocol: Protocol) -> (Result<(), String>, String) {
    mock_response(body.as_bytes(), body.len(), protocol).await
}

async fn mock_response(
    body: &[u8],
    declared_length: usize,
    protocol: Protocol,
) -> (Result<(), String>, String) {
    // Loopback only: exercise the production HTTP-body/SSE/completion path without
    // provider credentials, paid calls, or a native UI mock that invents 'done'.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/stream", listener.local_addr().unwrap());
    let body = body.to_vec();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut bytes = [0; 1024];
            let count = socket.read(&mut bytes).unwrap();
            assert!(count > 0, "client closed before sending request headers");
            request.extend_from_slice(&bytes[..count]);
            assert!(request.len() <= 8192);
        }
        write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {declared_length}\r\nConnection: close\r\n\r\n").unwrap();
        // The receiver can reject an invalid stream before the server finishes writing.
        let _ = socket.write_all(&body);
    });
    let response = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap()
        .get(url)
        .send()
        .await
        .unwrap();
    let mut text = String::new();
    let result = receive(response, protocol, |chunk| text.push_str(&chunk)).await;
    server.join().unwrap();
    (result, text)
}

#[tokio::test]
async fn openai_requires_successful_stop_and_done_and_allows_usage_metadata() {
    let wire = data(json!({"choices":[{"index":0,"delta":{"role":"assistant"}}]}))
        + &openai_text("Привет café 👋")
        + &openai_stop("stop")
        + &data(json!({"choices":[],"usage":{"completion_tokens":10}}))
        + "data: [DONE]\n\n";
    let (result, text) = request(&wire, Protocol::OpenAi).await;
    assert_eq!(result, Ok(()));
    assert_eq!(text, "Привет café 👋");
}

#[tokio::test]
async fn openai_rejects_all_unsuccessful_finish_reasons() {
    for reason in [
        "length",
        "content_filter",
        "tool_calls",
        "function_call",
        "unknown-secret",
    ] {
        let wire = openai_text("Partial replacement") + &openai_stop(reason) + "data: [DONE]\n\n";
        let (result, _) = request(&wire, Protocol::OpenAi).await;
        let error = result.unwrap_err();
        assert!(!error.contains("unknown-secret"));
        if reason == "length" {
            assert_eq!(error, OUTPUT_LIMIT);
        }
    }
}

#[tokio::test]
async fn openai_rejects_missing_terminal_events_and_empty_replacements() {
    for wire in [
        openai_text("Partial") + "data: [DONE]\n\n",
        openai_text("Partial") + &openai_stop("stop"),
        openai_text("Partial"),
        "data: [DONE]\n\n".into(),
        openai_text(" \n") + &openai_stop("stop") + "data: [DONE]\n\n",
    ] {
        assert!(request(&wire, Protocol::OpenAi).await.0.is_err());
    }
}

#[tokio::test]
async fn malformed_json_and_invalid_shapes_cannot_be_skipped_before_done() {
    for invalid in [
        "{broken secret",
        "[]",
        "null",
        "{}",
        r#"{"choices":"secret"}"#,
        r#"{"choices":[{"delta":{"content":42}}]}"#,
    ] {
        for protocol in [Protocol::OpenAi, Protocol::Anthropic] {
            let (prefix, suffix) = match protocol {
                Protocol::OpenAi => (
                    openai_text("Partial"),
                    openai_stop("stop") + "data: [DONE]\n\n",
                ),
                Protocol::Anthropic => (
                    anthropic_text("Partial"),
                    anthropic_stop("end_turn") + &anthropic_done(),
                ),
            };
            let wire = format!("{prefix}data: {invalid}\n\n{suffix}");
            let error = request(&wire, protocol).await.0.unwrap_err();
            assert_eq!(error, INVALID);
        }
    }
}

#[tokio::test]
async fn errors_after_stop_but_before_done_still_block_application() {
    let wire = openai_text("Draft")
        + &openai_stop("stop")
        + &data(json!({"error":{"message":"secret key and private prompt"}}))
        + "data: [DONE]\n\n";
    assert_eq!(
        request(&wire, Protocol::OpenAi).await.0.unwrap_err(),
        PROVIDER_ERROR
    );
}

#[tokio::test]
async fn anthropic_requires_successful_stop_reason_and_message_stop() {
    for reason in ["end_turn", "stop_sequence"] {
        let wire = data(json!({"type":"message_start","message":{"role":"assistant"}}))
            + &data(
                json!({"type":"content_block_start","content_block":{"type":"text","text":""}}),
            )
            + &anthropic_text("Привет café 👋")
            + &data(json!({"type":"content_block_stop","index":0}))
            + &anthropic_stop(reason)
            + &data(json!({"type":"ping"}))
            + &anthropic_done();
        let (result, text) = request(&wire, Protocol::Anthropic).await;
        assert_eq!(result, Ok(()));
        assert_eq!(text, "Привет café 👋");
    }
}

#[tokio::test]
async fn anthropic_rejects_refusals_limits_tools_pauses_and_unknown_reasons() {
    for reason in [
        "max_tokens",
        "refusal",
        "tool_use",
        "pause_turn",
        "model_context_window_exceeded",
        "unknown-secret",
    ] {
        let wire = anthropic_text("Partial") + &anthropic_stop(reason) + &anthropic_done();
        let error = request(&wire, Protocol::Anthropic).await.0.unwrap_err();
        assert!(!error.contains("unknown-secret"));
        if reason == "max_tokens" {
            assert_eq!(error, OUTPUT_LIMIT);
        }
    }
}

#[tokio::test]
async fn anthropic_rejects_missing_terminal_events_empty_text_and_openai_done() {
    for wire in [
        anthropic_text("Partial") + &anthropic_done(),
        anthropic_text("Partial") + &anthropic_stop("end_turn"),
        anthropic_text("Partial") + "data: [DONE]\n\n",
        anthropic_stop("end_turn") + &anthropic_done(),
        anthropic_text(" \n") + &anthropic_stop("end_turn") + &anthropic_done(),
    ] {
        assert!(request(&wire, Protocol::Anthropic).await.0.is_err());
    }
}

#[tokio::test]
async fn refusals_and_tool_payloads_are_never_replacement_text() {
    for delta in [
        json!({"refusal":"secret refusal"}),
        json!({"tool_calls":[]}),
        json!({"function_call":{"name":"secret"}}),
    ] {
        let wire = openai_text("Partial")
            + &data(json!({"choices":[{"delta":delta,"finish_reason":"stop"}]}))
            + "data: [DONE]\n\n";
        let error = request(&wire, Protocol::OpenAi).await.0.unwrap_err();
        assert!(!error.contains("secret"));
    }
    let wire = anthropic_text("Partial")
        + &data(
            json!({"type":"content_block_start","content_block":{"type":"tool_use","input":{"secret":"private"}}}),
        )
        + &anthropic_stop("end_turn")
        + &anthropic_done();
    assert!(request(&wire, Protocol::Anthropic).await.0.is_err());
}

#[tokio::test]
async fn provider_error_payloads_are_replaced_with_a_fixed_safe_message() {
    for payload in [
        json!({"error":{"type":"secret-key","message":"private prompt data:image/png;base64,PRIVATE"}}),
        json!({"error":"secret-key"}),
        json!({"type":"error","message":"secret-key"}),
    ] {
        for protocol in [Protocol::OpenAi, Protocol::Anthropic] {
            let error = request(&data(payload.clone()), protocol)
                .await
                .0
                .unwrap_err();
            assert_eq!(error, PROVIDER_ERROR);
            assert!(!error.contains("PRIVATE"));
            assert!(!error.contains("secret-key"));
        }
    }
}

#[tokio::test]
async fn supports_optional_sse_spacing_comments_and_multiline_data() {
    let wire = ": keepalive\r\n\r\nevent: message\r\nid: 1\r\ndata:{\r\ndata: \"choices\": [{\"delta\":{\"content\":\"OK\"}}]}\r\n\r\n".to_string()
        + &openai_stop("stop").replace('\n', "\r\n") + "data:[DONE]\r\n\r\n";
    let (result, text) = request(&wire, Protocol::OpenAi).await;
    assert_eq!(result, Ok(()));
    assert_eq!(text, "OK");
}

#[test]
fn completion_validation_survives_every_utf8_chunk_boundary_for_both_providers() {
    for (protocol, wire) in [
        (
            Protocol::OpenAi,
            openai_text("Привет café 👋") + &openai_stop("stop") + "data: [DONE]\n\n",
        ),
        (
            Protocol::Anthropic,
            anthropic_text("Привет café 👋") + &anthropic_stop("end_turn") + &anthropic_done(),
        ),
    ] {
        for split in 0..wire.len() {
            let mut decoder = sse::Events::default();
            let mut completion = Completion::new(protocol);
            let mut text = String::new();
            for bytes in [&wire.as_bytes()[..split], &wire.as_bytes()[split..]] {
                for event in decoder.push(bytes).unwrap() {
                    if let Some(chunk) = completion.event(&event).unwrap() {
                        text.push_str(&chunk);
                    }
                }
            }
            assert!(completion.complete);
            assert_eq!(text, "Привет café 👋");
        }
    }
}

#[tokio::test]
async fn disconnected_http_body_and_invalid_utf8_fail_closed() {
    let body = openai_text("Partial");
    assert!(
        mock_response(body.as_bytes(), body.len() + 100, Protocol::OpenAi)
            .await
            .0
            .is_err()
    );
    assert!(
        request(&(body.clone() + "data: {partial"), Protocol::OpenAi)
            .await
            .0
            .is_err()
    );
    let bytes = [body.as_bytes(), b"data: \xff\n\n"].concat();
    assert!(mock_response(&bytes, bytes.len(), Protocol::OpenAi)
        .await
        .0
        .is_err());
}

#[tokio::test]
async fn output_size_limits_remain_enforced_before_completion() {
    let wire =
        openai_text(&"x".repeat(2 * 1024 * 1024 + 1)) + &openai_stop("stop") + "data: [DONE]\n\n";
    let (result, text) = request(&wire, Protocol::OpenAi).await;
    assert!(result.unwrap_err().contains("text limit"));
    assert!(text.is_empty());
}
