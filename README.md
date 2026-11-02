# Forge

A private desktop workspace for local GGUF models, chats, documents, tools and LoRA training. Forge is an independent implementation inspired by a project workspace; it does not contain Bionic application code.

## Install

Download the package for your OS and CPU from [GitHub Releases](https://github.com/SinghAbhinav04/Forge/releases).

| System | Package / app search |
| --- | --- |
| Windows x64 / ARM64 | Run the `.exe` installer. It creates a Start menu entry and desktop shortcut named Forge. |
| macOS Intel / Apple Silicon | Open the matching DMG and move Forge.app into Applications for Spotlight/Launchpad. |
| Linux x64 / ARM64 | Install the `.deb`, or run the AppImage and use Settings → General → Register app shortcut. AppImage desktop integration varies by distribution. |

Packages use the same application source and features. Models, native inference runtimes, Whisper and the optional Python training engine are configured separately on each computer. GPU drivers, available memory, model architecture and optional engines determine which operations that computer can run. The first release is unsigned; signing/notarization needs maintainer credentials. Do not disable OS security checks globally.

## First model and chat

1. Open Settings → Runtime. Install an official llama.cpp runtime: CPU, CUDA for compatible NVIDIA hardware, or Vulkan where offered. macOS runtimes include Metal. You can select an existing `llama-server` executable instead.
2. In Library, choose the folder containing your GGUF files. Explore can search public Hugging Face repositories and download models/projectors with pause/resume and checksum verification when provided.
3. Choose CPU/RAM, GPU/VRAM or hybrid. Hybrid automatically chooses a layer split from current free RAM and reported VRAM; disable automatic placement in Runtime for a manual count. RAM and dedicated VRAM are separate pools, not a combined allocation. Some architectures retain CPU tensors even with full GPU offload. Apple Silicon shares unified memory.
4. Load a model and wait for Model ready. Cancel loading or unload it at any time. Start with a small context and increase only within memory headroom.
5. Open **Chat** for normal conversation, or **Workspace** to use project files and agent tools. Each tab has its own conversations and system prompt. The workspace agent can propose writes, which require your approval.

Settings include the system prompt, temperature, top-P/top-K/min-P, repeat penalty, seed, context/output limits, thinking mode, template override, CPU threads, GPU layers, KV-cache placement and per-model defaults. Loading settings require a reload. One inference model and one active chat/API task are supported at a time.

**Chat** opens by default for new profiles. It has no project file panel, workspace tool calls, or project conversation history. Change its prompt in Settings → Chat. **Workspace** retains project sessions and file tools; its prompt is in Settings → Workspace agent. Existing conversations from before this separation remain in Workspace. Both tabs keep their own last selected conversation, and enabled skills plus each session's own saved notes still apply.

Use **System prompt** beside the composer to save instructions for just that conversation, or choose the app default. You can create/open other chats and prepare their text, image and prompt drafts while a reply continues in its original chat. The generation banner offers View reply and Stop. One model request runs at a time; the next message can be sent when it finishes. Pending workspace write approvals remain attached to the original conversation.

Settings → Appearance offers Forest, Daylight, Midnight, Ocean, Amethyst, Graphite, Sand and Follow system. Theme selection persists after restart.

## Vision and tools

Vision needs a **vision-capable model and its matching `mmproj` GGUF**. Select the projector in Local Model Defaults, load the pair, then attach PNG/JPEG/WebP images in chat. Forge resizes images for a bounded local attachment and preserves them in the session. Gemma's capabilities vary by variant; Gemma 4 E4B is multimodal. A text-only model cannot gain vision by attaching an unrelated projector. The projector currently runs on CPU to preserve GPU memory, so it also needs RAM. Smaller projector quantizations trade quality for memory.

Attach image also works before vision is configured. Choose an image, paste one from the clipboard or drop it onto the composer, then use **Set up vision** to select the matching local projector. The app saves the pair per model and reloads it with a larger image context window while keeping memory guards enabled. Model reload waits until the current response finishes. Common browser-decodable source images are converted to bounded JPEG attachments; unsupported image formats show an error. Up to two images are supported per message.

Workspace tools list/read files and propose writes with stale-file conflict checks. PDF, DOCX and legacy DOC can be read as extracted text; scanned PDFs need OCR first. Native PDF/Word layout editing/export, a built-in terminal, and web browsing are not included. Connect external capabilities through Settings → MCP; each external tool call requires approval. Tool-calling quality depends on the model and its chat template.

Import a skill folder containing `SKILL.md`, or add a Markdown skill, in Settings → Skills. Enabled instructions are loaded into each new model request, shown in chat, and refreshed from disk. The model can request text references from that skill's folder. Skills are instructions, not executable plugins; importing a script does not automatically execute it.

## Chats, background operation and privacy

Each session is a separate JSON file in `sessions/chats/`. History, image attachments and saved session notes persist across restarts. Notes are always included in context; older complete turns are omitted from individual requests when necessary to fit the context window, while full history stays on disk. Fork, rename, archive/restore and JSON export/import are available. Settings → Sessions can open or relocate the chat folder.

Closing the window keeps Forge and its model alive by default. Use the tray/menu-bar icon → Show Forge, Stop model or Quit Forge. macOS also retains the Dock entry. Disable background operation in General if closing should quit. Linux tray availability depends on desktop extensions.

Development stores data in `.data/`. Installed apps store settings and local data under Electron's per-user application-data folder (`Forge/data`, or a detected legacy Local Desk profile). The default project is `Documents/Forge`; imported project folders are edited in place. Models are referenced in their selected folder. Open the actual folders through Settings rather than guessing platform-specific paths. Downloads, checkpoints and adapters remain local. The trained adapter library lives under `trained/` in the data folder.

Normal inference needs no cloud account. Optional downloads contact GitHub/Hugging Face; remote endpoints and MCP services use the connections you configure. Local Model API is independently started, key-protected, and loopback-only by default. LAN listening is an explicit setting. Billing and Usage shows local request/token records; Forge does not sell inference credits. Remote Devices uses OpenAI-compatible endpoints, not proprietary LM Link.

The sandboxed renderer has no Node access. A separate utility process owns the backend; inference/training run in child processes at reduced priority. File tools reject traversal, symlinks/junctions and protected paths. Writes and external MCP calls require review.

## Training and reusable LoRAs

See [TRAINING.md](TRAINING.md) for formats, preprocessing, pause/resume, conversion and stacking. The Trainer imports common chat schemas, WhatsApp TXT, Instagram message JSON and readable documents. Named chats ask whose replies to learn and show original/prepared examples for confirmation. Other participants provide context; training learns only the chosen person’s replies. Changed files require a fresh preview. It trains a supported local Hugging Face **causal language model**, not a quantized GGUF directly. Dataset normalization is generic; final token formatting uses that model's tokenizer/chat template when available.

## Loading responsiveness and performance

The responsive profile limits CPU work, disables runtime warm-up/repacking and streams weights into the runtime rather than eagerly paging in the whole Windows model file. Supported large embedding tables use on-demand reads independently of the streamed loading of other weights, including on Windows. CUDA may use small native staging buffers; other backends may upload a tensor at a time. Loading is cancellable. A preflight RAM/VRAM estimate and live RAM guard refuse/stop unsafe loads. This reduces resource spikes; no application can guarantee zero OS stalls on every driver or memory-starved machine.

On the development Ryzen 5 3600 / GTX 1660 6 GB / 16 GB PC, actual Gemma 4 E4B Q5 hybrid loading with streamed weights and on-demand embeddings succeeded with only about 4 GiB initially free. It loaded in **15.6 seconds**, generated a reply, and left at least **2.8 GiB free**, with the 2 GiB reserve unchanged. A subsequent cached desktop run loaded in **6 seconds**, with a **24 ms** maximum UI timer gap. Automatic hybrid placement chose 41 of 43 offload slots instead of the old fixed 8. These are single-run measurements, not promised rates. CPU-only generation speed has not been measured. Chat displays observed tokens/s and first-token latency; speed varies with quantization, context, offload, storage and concurrent apps.

An actual Gemma vision check correctly identified a red square and blue circle with a separate Q4 projector copy. A subsequent short text response measured **27.6 tokens/s**, with a 242 ms first token, at 2,048 context tokens using CUDA, host KV cache and two CPU threads. The test temporarily used a 1 GiB reserve to fit the available RAM; the app defaults to 2 GiB. These are measured single-run results, not a promised rate.

## Develop and build

Node.js 24 is used in CI. From this directory:

```sh
npm ci
npm run setup:runtime
npm run desktop
```

On Windows, `Start Forge.cmd` launches the development app. Optional browser operation: `npm start`, then open the complete printed URL including its token fragment.

```sh
npm run check
npm test
npm run test:desktop
npm run pack
npm run dist:win -- --publish never
```

Build macOS on macOS (`npm run dist:mac`) and Linux on Linux (`npm run dist:linux`). The workflow builds Windows/macOS/Linux x64 and ARM64 packages, runs backend checks, and publishes installers plus SHA256SUMS.txt on matching `v<package-version>` tags. See [BUILD_PLAN.md](BUILD_PLAN.md) for verification and release gates. Model and hardware smoke scripts require their documented local fixtures and are not all run by generic CI.

Windows has actual local GUI, inference, tool, persistence, voice, training and adapter-stack tests. macOS/Linux packages are configured for native CI builds; a successful build alone does not establish GPU, microphone, tray or model compatibility on every target. See [RELEASE_NOTES.md](RELEASE_NOTES.md) for current distribution limits.

## Upstream references

- [llama.cpp server and runtime options](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
- [Google Gemma model capabilities](https://ai.google.dev/gemma/docs/core)
- [PEFT LoRA](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
