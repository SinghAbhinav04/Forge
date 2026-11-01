# Training in Forge

## What to supply

Choose a **local Hugging Face causal language model folder** with `config.json`, tokenizer assets and supported weights. Choose a data file, name your LoRA and preview the detected examples. Install the optional training engine first; it uses an isolated Python environment under the Forge data folder. Python must be installed on the computer. CPU is the default; CUDA or Apple Metal requires a compatible PyTorch build and enough memory.

GGUF inference files cannot be trained directly here. The trainer updates LoRA adapters through PyTorch/PEFT while keeping the base model unchanged. It uses ordinary base weights, not 4-bit QLoRA, so a large model can require much more memory than its inference GGUF. An unload check and RAM preflight prevent training alongside Forge inference. GPU allocation can still fail if the selected base is too large; start with a small model.

## Automatic formats

| Input | Detection / interpretation |
| --- | --- |
| JSON / JSONL | `messages` role/content, ShareGPT conversations, Alpaca instruction/input/output, prompt/completion, question/answer, user/assistant, text examples, role-per-line, ChatGPT conversation exports and Claude chat messages |
| TXT / Markdown | Role-labelled user/assistant, human/assistant, user 1/user 2, Q/A, repeated two-speaker names and role headings. Adjacent same-role messages are merged. |
| PDF / DOCX / DOC | Extract readable text, detect labelled chat if present, otherwise split into text examples. Scanned/image-only PDFs need OCR before import. |
| CSV / TSV | Recognized paired/chat/text columns, parsed with quoted field and newline handling |
| Plain prose | Continued-language training on text chunks; Forge does not invent assistant answers from documents |

UTF-8, UTF-16 and common Windows text encodings are handled. Files are limited to 32 MiB; PDF extraction is limited to 1,000 pages. Extraction can lose tables/layout. Unsupported schemas, ambiguous multi-speaker chats, empty files and incomplete user-only conversations are rejected with a preprocessing message. No parser can safely interpret every arbitrary chat export: inspect the preview, roles and mode before training. For two arbitrary speaker names, the first speaker is treated as user and the second as assistant.

Normalization is shared across models. **Tokenization uses the selected model's tokenizer and chat template**, when available. The trainer currently trains all example tokens, including user turns; it does not provide assistant-only loss masking. Text documents produce continued-language examples rather than supervised question/answer pairs. Vision attachments, OCR and multimodal training are not supported by this trainer.

## Controls and checkpoints

Advanced training settings include learning rate, epochs/step cap, batch size, gradient accumulation, sequence length, LoRA rank and checkpoint interval. Longer examples are truncated to the selected sequence length. Start small and inspect the loss/progress; more steps do not guarantee better responses.

- **Pause** requests a checkpoint at an optimizer-step boundary. It may take time to finish the current step.
- **Resume** restores the latest completed adapter, optimizer and random-state checkpoint. It requires the same local base, tokenizer and prepared data.
- **Cancel** terminates the worker and its children. Resume is possible from a completed checkpoint; work since that checkpoint is lost. Cancellation before the first checkpoint has nothing to resume.
- Restart recovery marks an unfinished run as interrupted and permits checkpoint resume.

## Named adapters, conversion and stacking

Completed adapters are copied into `trained/<name>--<id>/` under Forge's data folder. Name the run before starting, or rename the library entry afterward. The folder retains PEFT weights/configuration; checkpoints remain under `training/<job-id>/`. Open trained storage from the UI.

To apply an adapter to llama.cpp:

1. Keep the original Hugging Face base used in training.
2. Add the **matching base GGUF** to the model library. A similar model name is not sufficient; architecture and base weights must match.
3. Use Convert in the trained library. Forge obtains the official llama.cpp converter and dependencies, then converts the PEFT adapter into a GGUF LoRA. Initial conversion needs internet access and the training Python environment.
4. Associate the result with the exact base GGUF. Enable one or more library adapters and choose their scales.
5. Load/reload that base model to preload selected adapters. Active preloaded scales can be changed or disabled without retraining. Newly added adapters require a reload.

Up to eight compatible adapters can be stacked with scales from 0 to 2. Stacking effects are model-dependent and can reduce quality. Removing an entry disables/removes its registration but preserves its files. Do not apply an adapter to an unrelated base. Forge currently converts adapters, not a missing full base model into GGUF; obtain or convert that base separately.
