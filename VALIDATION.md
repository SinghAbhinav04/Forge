# Forge 0.4.1 local validation

- JavaScript syntax checks pass. Backend suite: 92 checks, 91 passed and one skipped for Windows symlink privileges.
- `npm run test:usability` verifies delayed file opens across projects and within a project, edits during pending opens and saves, keyboard menu navigation, single runtime controls, incremental response nodes and final Markdown, plus guided LoRA conversion/loading/activation and cancellation. LoRA conversion and runtime operations in this UI regression use fixtures; it does not measure real-model quality.
- Conversation streaming/isolation, queued messages, document attachments, durable drafts, project knowledge (text/PDF), model conversion controls and training-data review desktop regressions pass with isolated profiles.
- The knowledge cache regression confirms unchanged indexes are parsed once across repeated list/search requests, external index changes invalidate the cache, and changed source files are still excluded.
- The local Windows installer builds successfully. Packaged native launch, resources, PDF/Word extraction, settings/background close, the package-version label, and knowledge-worker indexing/retrieval from app.asar pass. Composer-menu and simplified-runtime screenshots were visually checked.
- The release workflow includes the new usability regression. No macOS/Linux physical-device or new GPU/training-quality claim is made for this local update.

Previous validation records:

# Forge 0.2.7 training-data checks

41 backend checks pass, including WhatsApp Android/iOS imports, Unicode/group speakers, Instagram chronological ordering, target selection, original/prepared previews and changed-file rejection. The desktop review regression passes with a separate test profile: explicit selection, comparison samples, confirmation, and source/speaker invalidation. Four real-tokenizer checks verify reply-only labels, context masking, padding, truncation and unsupported-template rejection. Tiny-model LoRA training verifies actual updates and checkpoint controls; this does not establish personalization quality on a real chat corpus. No physical macOS training test was performed.

# Forge 0.2.6 verification

## Automated checks

The backend suite has 38 tests covering file confinement, stale-write protection, approvals/cancellation, stream errors, saved chats/migration/recovery, per-chat prompts, Chat/Workspace separation, MCP, remote/local APIs, dataset extraction, skills, downloads and safe projector discovery.

`node scripts/smoke-chat.mjs` checks separate prompts/history/drafts, Workspace file reads and restart persistence with a local test endpoint.

`node scripts/smoke-composer.mjs` checks creating/switching chats during a delayed live stream, background reply/reasoning isolation, per-chat prompts and image drafts, cancellation from another chat, pending approval restoration, the two ChatGPT/Claude theme styles and typography, and restart persistence. Both GUI regressions run in the Windows x64 release job. Backend checks and native package builds run on Windows/macOS/Linux x64 and ARM64 runners.

Packaged Windows verification covers native launch, embedded resources, PDF/Word extraction, settings and background closing. Native macOS/Linux GPU/audio behavior still requires target-device testing; successful package builds do not establish universal hardware compatibility.

## Real model observations on the development PC

Hardware: Ryzen 5 3600, GTX 1660 6 GiB, 16 GiB RAM. Model: Gemma 4 E4B Q5_K_M, official llama.cpp CUDA runtime.

- Streamed weights with on-demand embeddings loaded in hybrid mode in 15.6 s when little RAM was free; at least 2.8 GiB remained available, with the 2 GiB reserve unchanged. A cached desktop run loaded in 6 s with a 24 ms maximum UI timer gap. Automatic placement selected 41/43 offload slots. These are individual observations, not promised rates.
- Real normal Chat answered geography, arithmetic and a joke correctly after visiting a Workspace conversation containing Welcome.md.
- `node scripts/smoke-image-setup.mjs` verifies attachment before a model is loaded, projector setup/persistence, per-chat prompt saving and actual vision. Gemma recognized the red square and blue circle; at least 5.1 GiB remained free in that measured run. `--installed` verifies the Windows installed app/profile and deletes only its own verification conversation.
- CPU/GPU/hybrid inference passed on a separate small GGUF with offload counts confirmed in logs. CPU-only speed for the larger Gemma has not been benchmarked.
- Earlier real checks covered local Whisper WAV transcription, tiny-model LoRA updates, checkpoint pause/resume/cancel, adapter conversion and two-adapter stacking. Larger training jobs depend on base-model compatibility and memory.

Hardware checks require local fixtures and optional engines; they are not all run by generic CI. Keep heavy model checks sequential on memory-limited machines. Models, datasets, chats, runtime binaries, checkpoints and test artifacts are excluded from the repository and installers.
