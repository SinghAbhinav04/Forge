Forge 0.2.7 adds reviewed chat-data preparation and reply-only LoRA training.

- **Choose whose replies to learn:** named chats ask for a participant instead of assigning roles by speaking order. Common WhatsApp Android/iOS TXT and Instagram message JSON exports are supported, including multiline messages and Unicode names. Group context retains the other participants' names.
- **Original versus prepared samples:** compare source messages with normalized training examples and confirm the preview. Changing the participant or source invalidates confirmation; training verifies that the reviewed files have not changed.
- **Reply-only learning:** other people's messages and earlier conversation turns provide context. Only the chosen person's final reply in each named-chat example contributes training loss. Existing canonical chats learn assistant replies only; plain documents retain text training. The selected model's chat tokenizer determines token boundaries, with explicit rejection of unsupported templates.
- **Import transparency:** skipped media/notices, opening replies without context and unanswered final turns are reported. Base model weights remain unchanged; named LoRA storage, conversion, stacking and removal continue to work.

Also included from previous releases:

- **Chat and Workspace tabs:** independent histories and prompts. Chat handles normal conversation; Workspace retains project files, agent tools and approvals. Existing sessions remain in Workspace.
- **Per-chat system prompts:** edit instructions beside the composer or inherit the app default. Prompts persist with that chat and survive export/import.
- **Background replies:** create/open other chats and prepare drafts while a reply continues in its original conversation. Return through View reply, or stop it from the generation banner. Text, image and prompt drafts stay with their own chats; pending write approvals are retained. One model request runs at a time.
- **Image attachments and setup:** choose, paste or drop images before vision is configured. Set up the matching local projector through the composer; settings are saved per model. Actual Gemma image understanding was verified.
- **Themes:** Forest, Daylight, Midnight, Ocean, Amethyst, Graphite, Sand and Follow system.
- **Low-memory loading:** streamed weights plus on-demand large embeddings, including Windows. Automatic hybrid layer placement uses available RAM/VRAM while preserving the configured reserve. Actual Gemma hybrid loading/inference passed with low free RAM.
- **Windows fixes:** the model folder picker opens directly, missing default folders are created, and redirected profile storage handles rename/copy failures with recovery-backed writes.

Forge also includes persistent local sessions/notes, GGUF CPU/GPU/hybrid inference, document tools, MCP, skills, local API/remote endpoints, local Whisper setup, and optional LoRA training/conversion/stacking.

Download the package matching your operating system and CPU architecture. Installers contain the application features; models, native inference/voice runtimes and the optional Python training engine are configured separately on each computer. Training uses a supported local Hugging Face causal model, not a GGUF directly. Hardware memory, GPU drivers and model capabilities still determine what each device can run.

Packages are currently unsigned. macOS distribution is not notarized; Windows SmartScreen and macOS may require source verification and an explicit per-app allowance. Linux AppImage operation depends on desktop/FUSE support. Windows ARM64 is cross-built. All platform packages run backend checks; the Windows x64 job also runs GUI regressions. Native macOS/Linux GPU/audio behavior has not been tested on physical machines in this development session.

See README.md and TRAINING.md for setup and supported data formats. VALIDATION.md records test scope and hardware observations. SHA256SUMS.txt contains package checksums.
