Forge 0.2.2 is a local desktop AI workspace for Windows, macOS, and Linux.

This update fixes the Library's Change folder button so it opens the native picker directly, validates folder selections, and creates an empty default model folder on first launch.

Redirected Windows profile storage now handles cross-device rename failures with a completed recovery copy before replacement. Interrupted settings/chat copies can recover on restart while preserving damaged originals.

- GGUF inference with CPU/RAM, GPU/VRAM, and hybrid layer offloading.
- Image attachments with a compatible vision model and matching GGUF projector.
- Responsive resource profile, memory headroom checks, loading cancellation, and runtime logs.
- Individual local chat files, session notes, restart recovery, fork/archive/restore, and export/import.
- Document editing and an agent with reviewable file writes.
- Advanced system prompt, temperature, top-P/top-K/min-P, repeat penalty, seed, and context controls.
- Local Whisper voice transcription and optional system speech playback.
- MCP tools, reusable skills, remote OpenAI-compatible devices, and a local model API.
- Optional local LoRA trainer with optimizer checkpoints, pause/resume, cancellation, and adapter export.
- Automatic chat/document dataset import (JSON/JSONL/TXT/Markdown/CSV/TSV/PDF/DOCX/DOC), named trained adapters, GGUF conversion and multi-adapter stacking.
- New Forge icon, themes, and background tray/dock operation.

Choose the package matching your OS and CPU architecture. Models, inference runtimes, Whisper models, and the optional Python training environment are downloaded/configured separately and are not bundled in the installers.

The first release is unsigned. macOS users may need to explicitly allow the application in System Settings after verifying its source. Public notarized/signature-verified distribution requires maintainer signing credentials. Linux AppImage use depends on the host desktop/FUSE support. Windows ARM64 packages are cross-built; confirm native runtime and model compatibility on the target device.

Training requires a supported local Hugging Face base model; it does not modify GGUF files. The default training engine uses CPU PyTorch. GPU training needs a compatible GPU PyTorch installation and sufficient memory. Native OS audio, GPU driver compatibility, external MCP services, and remote devices also depend on their separate configuration.

See README.md for setup, local data paths, test coverage, and current limitations. SHA256SUMS.txt contains checksums for all packages in this release.
