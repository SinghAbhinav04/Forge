# Your local workspace

Welcome to Forge. Draft documents, work with code, and chat with models running on your computer.

1. In Settings → Runtime, install or choose a matching llama.cpp runtime.
2. In Models, choose your GGUF folder, select CPU/GPU/hybrid and load a model.
3. Start a session in Chat or Workspace agent mode.

Try: “Read Welcome.md, then draft a short project plan in Plan.md.” You review proposed file writes before they are applied. Text, Markdown and code can be edited; PDF and Word files can be read as extracted text.

Import reusable instructions through Settings → Skills. Add persistent session notes through Sessions. For images, first load a vision model with its matching projector in Local Model Defaults.

Trainer automatically imports common chat exports and readable documents, then trains a supported local Hugging Face base into a named LoRA. Check the detected data preview before starting. Training needs the optional Python engine and enough memory; a GGUF alone is not a training base.

Closing the window keeps Forge alive by default. Use its tray/menu-bar icon → Quit Forge to exit fully. Chats and notes are saved locally and restored when you return.
