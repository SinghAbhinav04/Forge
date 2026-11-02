Forge 0.3.0 makes local AI easier to set up and use, with guided model setup, a simpler workspace and improvements for long conversations.

### Getting started and models

- **Simpler model setup:** add local GGUF files, find a model, connect Ollama or convert a supported Hugging Face model folder to GGUF from one place. Conversion offers format and disk-space guidance, retains the original files and never overwrites an existing model.
- **Automatic hardware selection:** choose an appropriate runtime and CPU or hybrid execution by default. Forge checks supported NVIDIA driver/GPU information, verifies CUDA runtime device detection and falls back to CPU when GPU use cannot be verified. Manual settings remain available. Other GPU builds may require manual setup.
- **Fit and speed:** see download size and reported available memory before downloading, then check estimated model memory use after download. After a successful local response, model cards can show the generation speed reported by the runtime; speed is unknown until measured and varies by workload.

### A smoother everyday workflow

- **ChatGPT and Claude-inspired themes:** two coordinated styles with their own colors, font families and reading sizes.
- **Easier navigation:** grouped settings, a streamlined training flow, an activity drawer and contextual information buttons explain features where they are used.
- **More capable chat:** search conversations, copy replies and code, edit or retry in a copy, keep drafts between restarts, and queue one message while another is running. Attach local documents for questions with filename citations; remote providers receive any content sent to them.
- **Reviewed workspace changes:** preview assistant file edits and use conflict-checked history and undo for applied changes.

### Performance and reliability

- Faster context preparation for long conversations, lazy loading of chat history, targeted saves, separate image storage, batched streaming updates and fewer unnecessary interface refreshes.
- Better memory estimates, symlink-aware Hugging Face training weight checks, cached training tokenization and optional gradient checkpointing. Training can compare base and adapter responses using the same prompts.
- Storage cleanup previews protect current datasets and the latest checkpoints. Runtime errors and low-memory warnings provide clearer guidance.

Memory estimates are not guarantees. GPU availability, model architecture, context size and other workloads affect actual operation. Generation speed is a past measurement, not a prediction. GGUF conversion and hardware-specific training support depend on the model and installed dependencies; see README.md and TRAINING.md for details. Indexed document retrieval is not included; document attachments use extracted excerpts.

Download the package matching your operating system and architecture. Models and optional inference, voice and training tools are installed separately. Packages are unsigned and macOS builds are not notarized. Windows ARM64 is cross-built. The release workflow runs backend checks on all platforms and GUI regressions on Windows x64; this release has not been verified on every physical GPU. SHA256SUMS.txt contains package checksums.
