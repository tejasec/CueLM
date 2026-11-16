# AI models and image input

These changes are planned for 1.3.8 and are not in the published 1.3.7 packages.

## Choose a model

In Settings → AI, select OpenAI or Anthropic and enter an API key. HelixNotes fetches the provider's model catalog after a short pause. **Refresh models** fetches it again.

Catalog requests send the key to that provider's fixed HTTPS models endpoint. They do not send notes or generate a paid completion. Anthropic pagination is handled automatically. Catalog responses have size, count and timeout limits; redirects are not followed. Keys and provider error bodies are not included in catalog error messages.

Fetching a catalog never changes the selected model. Choose an entry or enter its ID in **Model ID (manual fallback)**. A saved ID remains available even if it is absent from the catalog or discovery fails. Model choices are remembered separately for each provider. Turning AI off retains saved keys and choices but disables AI requests.

OpenAI's catalog does not consistently describe chat or vision support. HelixNotes filters out recognizably non-chat model families, but a listed model can still be unavailable to your account or incompatible with the chat endpoint. Manual IDs remain available for models the filter misses. There are no automatic model substitutions or paid retries.

Ollama and OpenAI-compatible servers keep their manual model-ID and base-URL settings. Requests go to that URL, which is not necessarily on this device. Use the final server URL; AI requests do not follow redirects. **Test connection** is a separate, explicit request that generates a short reply and may incur provider charges.

## Include images

Open AI Actions in a note, with or without a text selection. **Images from this note** lists eligible local PNG, JPEG and WebP file references, including managed attachments. All checkboxes start unchecked each time the menu opens.

1. Check up to four images. The list covers the current note, even when only some text is selected.
2. Review the disclosure showing the destination, model and number of images.
3. Choose an AI action, **Describe selected images**, or a custom prompt.

Only checked files are included. An image elsewhere in the note is not sent unless you check it. Selecting checkboxes alone does not start an AI request. Remote URLs, data-URI images, PDFs, GIFs and other unsupported files are not offered as image inputs. The AI backend never fetches image URLs.

The chosen model and server must accept image input. OpenAI, Anthropic, and compatible vision models on Ollama/OpenAI-compatible servers receive actual image content blocks, not just Markdown links. Unsupported requests fail visibly; HelixNotes does not silently retry them without images.

### File and request limits

- Images must resolve inside the note's configured vault. Private hidden paths outside `.helixnotes/attachments` are rejected.
- Each source file is limited to 10 MiB and 20 megapixels. Reads, decoder allocation and encoded output are bounded.
- Images are oriented, reduced to at most 1,568 pixels on either side, and re-encoded in memory as PNG or JPEG. Small images are not enlarged. Encoded files are limited to 4 MiB each.
- Only a still-image rendition is sent, not an animation sequence. This is not PDF, audio or video analysis.
- Re-encoding omits source-file metadata. Source files, filenames and note references are not rewritten. Small text or fine detail can become less readable after resizing.
- Prompt text and the custom prompt together are limited to 2 MiB. Images can increase token usage and cost.

Image requests check the provider, model and configured server against the settings shown in the requesting window. If those settings have changed, the request is rejected rather than sent to an unexpected destination.

## Review before applying

Rich-editor selections retain their Markdown structure, including image-only selections. Source-mode requests send the selected text, or the whole note when the selection is empty.

Images, reference definitions and PDF embeds use protected placeholders. An AI response that removes or duplicates a placeholder cannot be applied. A result also cannot be applied after switching or editing the originating note. Applying to an existing note requires a successful save and history snapshot first.

Only successfully completed text responses can be applied. OpenAI-compatible streams must report `finish_reason: "stop"` followed by `[DONE]`. Anthropic streams must report `end_turn` or `stop_sequence` followed by `message_stop`. Missing completion events, malformed payloads, output limits, refusals and tool requests block application, even if partial text is visible. Compatible servers must follow that completion contract; HelixNotes does not treat a dropped connection as success.

Streaming errors use fixed application messages rather than provider error bodies. Connection errors omit server URLs, which may contain credentials or query secrets.

Requests and attachment selection do not themselves edit notes or create history versions. Review the generated text before applying it. Closing the menu stops displaying the response; it does not promise cancellation of a request already sent to the provider.

## Verification and release checks

Automated tests cover provider payload shapes, catalog parsing/pagination, key-safe errors, bounded image preparation, vault/private-file checks, resizing, unchanged source bytes, media restoration, and Unicode split across streaming chunks. Loopback HTTP tests also exercise the production stream receiver for successful completion, malformed events, unsuccessful finish reasons, missing terminators, disconnections, output bounds and sanitized provider errors. Browser tests use a mocked native boundary for model settings and both editor modes.

No paid provider inference calls were used for these checks. Before release, test with real provider accounts, supported vision models, rebuilt desktop/mobile apps and representative screenshots. Browser mocks do not prove provider acceptance, native webview behavior or model accuracy.
