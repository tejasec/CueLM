# CueLM

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%208.0%2B%20(API%2026%2B)-brightgreen.svg)](https://github.com/tejasec/CueLM)
[![Framework](https://img.shields.io/badge/Framework-Tauri%20v2%20%7C%20SvelteKit-orange.svg)](https://v2.tauri.app/)
[![Hackathon](https://img.shields.io/badge/Hackathon-BharatCode%20Build%20League-purple.svg)](https://github.com/tejasec/CueLM)
[![Architecture](https://img.shields.io/badge/Architecture-Rust%20%2B%20Kotlin%20%2B%20Svelte-blueviolet.svg)](https://github.com/tejasec/CueLM)

> **CueLM** is a local-first academic note-taking application that combines rich Markdown notes, tasks, and knowledge graphs with embedded native lecture recording, waveform playback, and agentic AI cue extraction.

College lectures are fast-paced and cognitively demanding. Students routinely split their attention between absorbing complex theoretical explanations and frantically noting down spoken assignments, upcoming exam hints, and formula derivations. Traditional note apps force students to toggle between separate voice memo apps, cloud transcription tools, and text editors—creating fragmented notes and passive audio graveyards.

CueLM provides a unified solution: **at its foundation, it is a complete, distraction-free academic note-taking environment**—featuring live KaTeX math formula rendering, TipTap/CodeMirror editing, bi-directional `[[wiki-links]]`, global task checklist aggregation, interactive calendar scheduling, and full-text Tantivy search. Seamlessly integrated into this note-taking foundation is a native Android hardware audio recorder and agentic AI engine, allowing students to record classroom audio directly into their personal vaults, scrub waveforms right from their notes, and extract spoken deadlines with zero cloud lock-in.

---


## Core Note-Taking System

Most of CueLM's codebase and day-to-day functionality provides a local-first, distraction-free academic workspace built with SvelteKit, TipTap, CodeMirror, and Rust:

### 📝 Advanced Markdown & WYSIWYG Editing
- **Dual-Mode Writing**: Seamlessly switch between rich TipTap v3 editing and raw CodeMirror source mode with full Markdown syntax highlighting.
- **Slash Commands (`/`)**: Quick-insert blocks for headers, callouts, bullet lists, code blocks, color swatches (`/color`), and timestamps (`/date`, `/time`, `/now`).
- **External Document Support**: Open and view standalone `.md` files or import them directly into your active vault.

### 🕸️ Bi-directional `[[Wiki-links]]` & Knowledge Graph
- **Interconnected Notes**: Link concepts across lectures, subjects, and semesters using standard `[[Note Title]]` syntax.
- **Visual Graph View**: Interactive node graph mapping inter-note connections to help students visualize syllabus progress and conceptual relationships.

### 📅 Global Task Aggregation & Calendar View
- **Universal Checklist Harvester**: Scans every note across your vault to aggregate all `- [ ]` checklist tasks into a centralized workspace.
- **Interactive Calendar View**: Drag-and-drop task rescheduling, priority flags, and due-date tracking to keep assignments organized.

### 🔍 Instant Tantivy Full-Text Search
- **Rust-Powered Search Engine**: Embedded Tantivy engine provides sub-millisecond full-text search across thousands of Markdown documents, outlines, and tags.
- **CJK-Aware**: Built-in tokenization support for Chinese, Japanese, and Korean text.

### 📓 Daily Notes, Outlines, & Hierarchical Notebooks
- **Structured Hierarchy**: Organize notes into nested notebook trees with drag-and-drop reordering.
- **Daily Journaling**: Dedicated calendar view for automated daily lecture logs.
- **Outline & Tag System**: Dynamic table of contents outline panel and tag autocomplete with custom color styling.

---

## Native Lecture Recording & Audio Engine

Plugging directly into the note-taking core is a high-performance native audio recording pipeline built specifically for university lectures:

### 🎙️ Hardware Audio Recording & Lock-Screen Persistence
- **Foreground Service Architecture**: Declared with `FOREGROUND_SERVICE_MICROPHONE` and `RECORD_AUDIO` runtime permissions to record lectures continuously without interruption when the screen locks.
- **Embedded Audio Engine**: Powered by an embedded native AAR from [AudioRecorder v2.5.0](https://github.com/Dimowner/AudioRecorder), offering live waveform rendering, mono AAC encoding at 48 kbps, and minimal battery consumption.

### 🌉 Bidirectional `StorageBridge` IPC
- **Custom JavaScript-to-Native Bridge**: Exposes a clean `Android` bridge interface to the SvelteKit WebView (`StorageBridge.kt` / `MainActivity.kt`).
- **Dynamic Theme Synchronization**: Automatically propagates UI theme changes (light/dark mode, accent colors, background tones) into native Android activities for a unified visual experience.
- **Native Intent Handoffs**: Direct triggering of recording sessions, directory preparation, and external file viewers.

### 🗂️ Vault-Native Storage & Hierarchical Sub-Recordings
- **In-Vault Storage**: Audio files save directly into `{vault}/Recordings/` alongside standard Markdown files.
- **Nested Sub-Recordings**: Support for branched sub-recordings (`parent__sub__child` naming scheme) to segment lectures into specific discussions, derivations, or Q&A periods.
- **Unified Tantivy Indexing**: Audio file metadata and titles are indexed alongside text notes for rapid searching.

### 🎧 In-App Audio Playback & Waveform Scrubbing
- **Seamless Playback Handoff**: Launch audio playback directly from note attachments or the recordings sidebar (`playRecordingInAudioRecorder`).
- **Waveform Navigation**: Inspect waveforms, adjust playback speed, and jump directly to points of interest during study sessions.

---

## BharatCode Hackathon Innovation & AI Pipeline

CueLM was developed as part of the **BharatCode Build League** hackathon, focusing on active, student-first workflows powered by the hackathon's `qwen-3.8-27b` model API:

```
[Live Lecture Audio] ──► [Foreground AAC Capture] ──► [BharatCode qwen-3.8-27b]
                                                               │
       ┌───────────────────────────────┬───────────────────────┴───────────────────────────────┐
       ▼                               ▼                                                       ▼
[Exam Hint Radar]              [Actionable Tasks]                                     [Confusion Marker]
"Midterm derivation cue"       "Lab 3 due Friday" ──► Export .ics / Anki               "ELI5 explanation at 18:42"
```

1. **Exam Hint Radar**: Trains prompt extraction to identify high-stakes verbal cues (*"This will be on the exam"*, *"Make sure you memorize this derivation"*, *"Common viva question"*), displaying them in prioritized alert cards with timestamps.
2. **Live "Wait, What?" Confusion Marker**: A single-tap button for students during fast lectures. It logs the exact timestamp and prompts the AI to generate a simplified "Explain Like I'm 5" breakdown and step-by-step derivation for that lecture segment.
3. **Actionable Task & `.ics` Calendar Export**: Automatically parses spoken deadlines into structured task items with one-click `.ics` calendar generation and Anki-compatible `.csv` flashcard exports.

---

## Technology Breakdown

| Layer | Technologies | Role |
| :--- | :--- | :--- |
| **Note-Taking Frontend** | SvelteKit, Svelte 5, TailwindCSS v4, TipTap v3, CodeMirror, KaTeX, Mermaid.js | Reactive academic notes dashboard, KaTeX math editor, task calendar, and playback UI |
| **Native Core** | Rust, Tauri v2, Tantivy, Notify | File system operations, vault watching, and high-speed full-text search indexing |
| **Android Host** | Kotlin, Java 17, Jetpack Compose, Room SQLite 2.8.4, Jaudiotagger | Hardware audio management, foreground service, and JavaScript-to-Android IPC |
| **Embedded Engine** | AudioRecorder v2.5.0 (AAR) | Low-level PCM/AAC recording, audio waveform computation, and playback dialogs |
| **AI Layer** | BharatCode API (`qwen-3.8-27b`), Gemini Multimodal | Spoken task extraction, exam cue detection, and multimodal note generation |

---


## Building from Source

### Prerequisites

- **Java Development Kit**: OpenJDK 17 or 21 (`JAVA_HOME`)
- **Android SDK**: API Level 34+ with `build-tools/37.0.0`
- **Node.js**: v18+ with `pnpm`
- **Rust**: 1.88+ with Android compilation targets installed:
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```

---

## Project Structure

```text
src-tauri/gen/android/
├── app/
│   ├── build.gradle.kts          # Android build configuration, Room 2.8.4, Compose BOM
│   ├── libs/
│   │   └── audiorecorder.aar     # Embedded AudioRecorder v2.5.0 native library
│   └── src/main/
│       ├── AndroidManifest.xml    # Foreground service permissions and activity declarations
│       └── java/com/cuelm/app/
│           ├── CueLMApplication.java
│           ├── MainActivity.kt    # StorageBridge implementation and IPC handlers
│           └── StorageBridge.kt   # JavaScript interface exposed to Tauri WebView
├── buildSrc/                     # Custom Gradle plugin for cross-compiling Rust libraries
├── gradle/wrapper/               # Gradle wrapper distribution (v8.11.1)
├── build.gradle.kts              # Top-level Gradle project configuration
├── gradle.properties             # Build environment properties and JVM args
├── LICENSE                       # AGPL-3.0 License
└── README.md                     # Project documentation
```

---

## Roadmap

- [x] Full-featured academic Markdown editor with live KaTeX math formula rendering
- [x] Global `- [ ]` checklist task aggregator and interactive calendar view
- [x] Bi-directional `[[wiki-links]]` and interactive knowledge graph view
- [x] Embed native AudioRecorder v2 AAR into Tauri v2 Android host
- [x] Implement bidirectional `StorageBridge` IPC for theme and audio controls
- [x] In-app audio playback and nested sub-recordings hierarchy (`__sub__`)
- [x] Local vault storage (`{vault}/Recordings/`) with Tantivy search indexing
- [x] Connect BharatCode Hackathon API (`qwen-3.8-27b`) for localized task extraction
- [ ] Live "Wait, What?" confusion button with audio timestamp seeking
- [ ] Exam Hint Radar warning cards and `.ics` calendar invitation exports
- [ ] Two-way automated sync with Gemini Notebooks via `notebooklm-py`
- [ ] Whiteboard photo and lecture slide multimodal fusion

---

## Attributions & Acknowledgments

CueLM builds upon exceptional open-source software:

- **[HelixNotes](https://gitlab.com/ArkHost/HelixNotes)** by **Yuri Karamian** ([ArkHost](https://gitlab.com/ArkHost)): The local-first Markdown note-taking engine, Tantivy search integration, and SvelteKit desktop/mobile client.
- **[AudioRecorder](https://github.com/Dimowner/AudioRecorder)** by **Dmytro Ponomarenko**: The Android audio recording engine, waveform visualizer, and low-level audio processing implementation.
- **[BharatCode Build League](https://github.com/tejasec/CueLM)**: Hackathon host providing model endpoints and compute infrastructure.

---

## License

CueLM is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See the [LICENSE](LICENSE) file for complete details.
