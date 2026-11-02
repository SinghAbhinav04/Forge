Forge 0.4.0 adds project knowledge, easier model discovery and more tools for working with local AI. This release delivers an initial set of the planned improvements; the remaining work is tracked in `ROADMAP.md`.

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

Download the package for your operating system and architecture: **macOS ARM64 for Apple Silicon**, **macOS x64 for Intel**, and the corresponding Windows or Linux package. Installers are unsigned and macOS builds are not notarized. Models and optional inference, voice and training tools are installed separately. SHA256SUMS.txt contains release checksums. See README.md, TRAINING.md and ROADMAP.md for setup, limitations and remaining work.
