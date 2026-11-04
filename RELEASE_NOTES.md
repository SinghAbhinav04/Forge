Forge 0.4.6 adds Instagram training-data import, CUDA training setup, and desktop workflow improvements.

### Training

- Import Instagram HTML exports from ZIP archives, individual pages, or chat folders. Select a thread and assign the assistant and context speakers. Review the original messages beside the prepared examples before training.
- Choose from detected local Hugging Face training bases. Forge fills in the folder automatically when it finds a single match and links to the GGUF model library for chat.
- Install the NVIDIA CUDA training engine on x64 Windows or Linux. Forge verifies a GPU operation before using it and keeps the CPU environment available.
- Training engine setup, checkpoints, and adapter saves handle Windows profiles redirected to a different drive.
- **Use this LoRA** guides base confirmation, conversion, loading, and activation, with an option to cancel setup.

### Chat and workspace

- File navigation ignores delayed responses from an earlier selection and preserves edits made during opens and saves. Line-range reads report clipped text.
- Project knowledge uses a bounded cache with saved-file revision checks. Chat streams update existing text and render Markdown on completion.
- The composer’s keyboard-accessible **+** menu groups images, documents, web search, and voice. A recording keeps a visible stop button.
- Manual inference controls are grouped in **Advanced runtime controls**. Readiness messages point to the relevant model, vision, or memory controls.

### macOS packages

Forge retains the ad-hoc signing and native startup checks introduced in 0.4.1. Choose **macOS ARM64 for Apple Silicon** or **macOS x64 for Intel**. macOS packages are ad-hoc signed and require per-app approval when Gatekeeper prompts.

The following features were introduced in 0.4.0. Remaining planned work is tracked in `ROADMAP.md`.

### Work with project knowledge

- Index individual files or folders from a project locally, including text, Markdown, PDF and Word documents. Processing runs in a cancellable worker; progress, errors and interrupted jobs are visible.
- Workspace questions can use keyword-matched passages from the project index. Forge shows the passages selected and line references for text files. Changed or missing files are skipped until re-indexed.
- Add instructions shared across a project's workspace conversations. Choose built-in prompt presets or save your own for an individual chat.
- Pin conversations, inspect a read-only Git status, and use an optional idle timer to unload local models.

Keyword matching can miss relevant passages; this release does not include semantic embeddings or PDF page-level citations. Indexing is limited to 50 files and one million extracted characters per file. Retrieved passages are stored with the chat and sent to the selected model, including remote providers.

### Models and research

- Discover models already managed by a local Ollama service and select them directly in the model library. Check the model in Ollama if it uses a cloud service.
- Start model search by task, see a labeled rough CPU-memory estimate before downloading, and inspect reported license information and model cards. Memory estimates are not guarantees.
- Measure a loaded local model's speed using three short runs. Forge shows the runtime-reported rates and configuration, not an invented prediction.
- Search the web through Ollama's online search service using an API key entered for the request. Review and attach search snippets and open source links; snippets are not full-page reads. Forge does not save the API key.

### Coding and reliability

- An optional command tool lets the workspace agent propose shell commands. It is **off by default** and every command requires explicit approval. Commands run on the host without an OS sandbox and can access files and networks beyond the project; review them carefully.
- Diagnostic exports no longer include runtime logs, local paths or credentials. Forge refuses to overwrite an unsupported newer data format.
- Improved job status, cancellation, document worker handling and context budgeting. Check the latest stable Forge version from Settings; installation remains manual.

### Remaining work and package notes

Semantic document retrieval, full assistant profiles, multi-file review, a sandboxed interactive terminal, richer research, expanded GPU support and further accessibility and physical-device validation remain on the roadmap. Benchmark results vary with hardware and workload; model, GPU and tool compatibility are not guaranteed.

Download the package for your operating system and architecture: **macOS ARM64 for Apple Silicon**, **macOS x64 for Intel**, and the corresponding Windows or Linux package. Windows installers are unsigned; macOS apps are ad-hoc signed and not notarized. Models and optional inference, voice and training tools are installed separately. SHA256SUMS.txt contains release checksums. See README.md, TRAINING.md and ROADMAP.md for setup, limitations and remaining work.
