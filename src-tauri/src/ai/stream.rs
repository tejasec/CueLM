//! Validate provider completion before a streamed draft becomes eligible for application.
//! All errors are app-owned strings: never forward provider payloads or transport URLs.
use futures::StreamExt;
use serde_json::Value;

use super::sse;

const INVALID: &str = "AI returned an invalid streaming response. The result cannot be applied.";
const INCOMPLETE: &str =
    "AI stream ended before successful completion. The result cannot be applied.";
const PROVIDER_ERROR: &str = "The AI provider reported a streaming error. Check the model, account and request, then try again.";
const OUTPUT_LIMIT: &str = "AI response reached its output limit. Use a smaller selection.";

#[derive(Clone, Copy)]
pub(super) enum Protocol {
    OpenAi,
    Anthropic,
}

struct Completion {
    protocol: Protocol,
    stopped: bool,
    complete: bool,
    has_text: bool,
}

impl Completion {
    fn new(protocol: Protocol) -> Self {
        Self {
            protocol,
            stopped: false,
            complete: false,
            has_text: false,
        }
    }

    fn event(&mut self, event: &str) -> Result<Option<String>, String> {
        // SSE joins multiple data fields with a newline. Comments, event names, IDs
        // and retry fields are not JSON payloads. A space after ':' is optional.
        let fields: Vec<_> = event
            .lines()
            .filter_map(|line| {
                line.strip_prefix("data:")
                    .map(|s| s.strip_prefix(' ').unwrap_or(s))
            })
            .collect();
        if fields.is_empty() {
            return Ok(None);
        }
        if self.complete {
            return Err(INVALID.into());
        }
        let data = fields.join("\n");
        if data == "[DONE]" {
            if !matches!(self.protocol, Protocol::OpenAi) || !self.stopped || !self.has_text {
                return Err(INCOMPLETE.into());
            }
            self.complete = true;
            return Ok(None);
        }
        let value: Value = serde_json::from_str(&data).map_err(|_| INVALID)?;
        if !value.is_object() {
            return Err(INVALID.into());
        }
        // Do not include the error's type, message or other provider-controlled data.
        if value.get("error").is_some_and(|error| !error.is_null()) || value["type"] == "error" {
            return Err(PROVIDER_ERROR.into());
        }
        let text = match self.protocol {
            Protocol::OpenAi => self.openai(&value)?,
            Protocol::Anthropic => self.anthropic(&value)?,
        };
        if let Some(text) = &text {
            self.has_text |= !text.trim().is_empty();
        }
        Ok(text)
    }

    fn openai(&mut self, value: &Value) -> Result<Option<String>, String> {
        let choices = value["choices"].as_array().ok_or(INVALID)?;
        // A final usage-only event is permitted, including between stop and [DONE].
        if choices.is_empty() && value["usage"].is_object() {
            return Ok(None);
        }
        if choices.len() != 1 || self.stopped {
            return Err(INVALID.into());
        }
        let choice = &choices[0];
        if choice.get("index").is_some_and(|index| index != 0) {
            return Err(INVALID.into());
        }
        let delta = choice["delta"].as_object().ok_or(INVALID)?;
        if delta.get("refusal").is_some_and(|v| !v.is_null()) {
            return Err(
                "The AI provider refused this request. The result cannot be applied.".into(),
            );
        }
        if ["tool_calls", "function_call"]
            .iter()
            .any(|key| delta.get(*key).is_some_and(|v| !v.is_null()))
        {
            return Err("AI returned a tool request instead of replacement text. The result cannot be applied.".into());
        }
        let text = match delta.get("content") {
            None | Some(Value::Null) => None,
            Some(Value::String(text)) => Some(text.clone()),
            _ => return Err(INVALID.into()),
        };
        match choice.get("finish_reason") {
            None | Some(Value::Null) => {}
            Some(Value::String(reason)) if reason == "stop" => self.stopped = true,
            Some(Value::String(reason)) if reason == "length" => return Err(OUTPUT_LIMIT.into()),
            Some(Value::String(_)) => {
                return Err(
                    "AI response did not finish successfully. The result cannot be applied.".into(),
                )
            }
            _ => return Err(INVALID.into()),
        }
        Ok(text)
    }

    fn anthropic(&mut self, value: &Value) -> Result<Option<String>, String> {
        let kind = value["type"].as_str().ok_or(INVALID)?;
        if self.stopped && !matches!(kind, "message_stop" | "ping") {
            return Err(INVALID.into());
        }
        match kind {
            "content_block_start" => {
                let block = &value["content_block"];
                match block["type"].as_str().ok_or(INVALID)? {
                    "text" => Ok(Some(block["text"].as_str().ok_or(INVALID)?.into())),
                    "thinking" | "redacted_thinking" => Ok(None),
                    _ => Err("AI returned unsupported content instead of replacement text. The result cannot be applied.".into()),
                }
            }
            "content_block_delta" => {
                let delta = &value["delta"];
                match delta["type"].as_str().ok_or(INVALID)? {
                    "text_delta" => Ok(Some(delta["text"].as_str().ok_or(INVALID)?.into())),
                    "thinking_delta" | "signature_delta" => Ok(None),
                    _ => Err(INVALID.into()),
                }
            }
            "message_delta" => {
                match value["delta"]["stop_reason"].as_str().ok_or(INVALID)? {
                    "end_turn" | "stop_sequence" => self.stopped = true,
                    "max_tokens" => return Err(OUTPUT_LIMIT.into()),
                    _ => return Err(
                        "AI response did not finish successfully. The result cannot be applied."
                            .into(),
                    ),
                }
                Ok(None)
            }
            "message_stop" => {
                if !self.stopped || !self.has_text {
                    return Err(INCOMPLETE.into());
                }
                self.complete = true;
                Ok(None)
            }
            // Anthropic may add informational events; they cannot mark completion.
            _ => Ok(None),
        }
    }
}

pub(super) async fn receive(
    response: reqwest::Response,
    protocol: Protocol,
    mut on_text: impl FnMut(String),
) -> Result<(), String> {
    let mut stream = response.bytes_stream();
    let mut decoder = sse::Events::default();
    let mut completion = Completion::new(protocol);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "AI stream connection failed")?;
        for event in decoder.push(&chunk)? {
            if let Some(text) = completion.event(&event)? {
                decoder.record_text(&text)?;
                if !text.is_empty() {
                    on_text(text);
                }
            }
        }
        if completion.complete {
            return Ok(());
        }
    }
    Err(INCOMPLETE.into())
}

#[cfg(test)]
#[path = "stream_tests.rs"]
mod tests;
