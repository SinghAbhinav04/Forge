# Forge implementation roadmap

This checklist tracks the work requested after the 0.3.0 release. A checkbox is complete only when its implementation and relevant tests exist; physical-device and packaged-app validation are tracked separately.

## Foundation

- [x] Privacy-limited diagnostic export with the installed version.
- [x] Refuse to overwrite unknown newer workspace formats.
- [x] Consistent activity status view for existing operations and knowledge indexing.
- [ ] Centralized resource arbitration, resumable job lifecycle and versioned migrations for future feature data.

## Models and onboarding

- [x] Task-oriented search entry points and rough, labeled CPU-only pre-download fit estimates.
- [x] Display reported license metadata and link to the model card.
- [x] Discover and select models from a local Ollama service.
- [x] Optional idle unload and a cancellable, repeated runtime-reported speed measurement for locally managed models; measurements remain historical.
- [ ] Curated model recommendations with verified capabilities, richer hardware-aware estimates and quantization comparison.
- [ ] Improved AMD/Intel accelerator detection and supported runtime selection.

## Project knowledge

- [x] Index individual project files and folders on-device in cancellable workers, with limits, stale detection, progress and interrupted-job reporting.
- [x] Keyword retrieval, visible retrieved passages and text-file line references, context budgeting and remote-provider disclosure.
- [ ] Better retrieval quality, optional local embeddings, passage-level citation validation, PDF page references, OCR and packaged-app coverage.

## Project workflows and coding

- [x] Shared project instructions, conversation pins, read-only Git status and reusable prompt presets.
- [x] Off-by-default host shell-command proposals with per-command approval, output limits and cancellation. Commands are not OS-sandboxed.
- [ ] Full assistant profiles, model/tool preferences, multi-file review, task summaries, interactive terminal and platform-appropriate isolation.
- [ ] Side-by-side work, richer task history and resource-aware concurrent jobs.

## Web, voice and accessibility

- [x] Explicit Ollama web search with ephemeral key entry and selectable snippets; snippets are not full-page reads.
- [ ] Page retrieval and citation-backed research, provider choice, stronger network protections and deeper research workflows.
- [ ] Voice interface enhancements and dedicated accessibility audits.

## Reliability and release

- [x] Manual update check against official stable releases without automatic installation.
- [ ] Packaged-app worker verification, real-model tests, cross-platform/GPU testing, benchmark coverage, signing/notarization and update recovery.
- [ ] Final release after all requested phases are implemented and validated.
