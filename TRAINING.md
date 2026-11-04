# Training in Forge

## What to supply

Choose a **local Hugging Face causal language model folder** with `config.json`, tokenizer assets and supported weights. Choose a data file, select **Detect participants & preview data**, then choose whose replies to learn for a named chat. Compare original messages and prepared examples, and confirm the preview before starting.

Install a training engine in **Trainer**. Forge offers **Install NVIDIA CUDA engine** on x64 Windows and Linux with a working NVIDIA driver. This downloads PyTorch for CUDA 12.8 and verifies a GPU operation before enabling the separate environment. **Install CPU training engine** installs the standard environment, which can also use Apple Metal when PyTorch reports MPS available. Both require Python 3.10 or later. **Automatic** uses an available GPU first. Choose **CPU / RAM** to run on CPU.

GGUF inference files cannot be trained directly here. The trainer updates LoRA adapters through PyTorch/PEFT while keeping the base model unchanged. It uses ordinary base weights, not 4-bit QLoRA, so a large model can require much more memory than its inference GGUF. An unload check and RAM preflight prevent training alongside Forge inference. GPU allocation can still fail if the selected base is too large; start with a small model.

## Automatic formats

| Input | Detection / interpretation |
| --- | --- |
| JSON / JSONL | `messages` role/content, ShareGPT conversations, Alpaca instruction/input/output, prompt/completion, question/answer, user/assistant, text examples, role-per-line, ChatGPT conversation exports and Claude chat messages |
| TXT / Markdown | Role-labelled user/assistant, human/assistant, user 1/user 2, Q/A, repeated two-speaker names and role headings. Adjacent same-role messages are merged. |
| WhatsApp TXT | Common Android and iOS timestamps, multiline text and Unicode participant names. Choose the target participant; media placeholders and platform notices are skipped. Export without media, then select the TXT file. |
| Instagram HTML / ZIP | Browse to the export ZIP or a `message_1.html` page. Use **Chat folder** to select one extracted chat and merge all its numbered HTML pages. The ZIP picker shows available titles, recent sender names, and folder IDs. Choose one thread per run. HTML imports support the English timestamp format and skip media without text, reaction metadata, and export link cards. |
| Instagram JSON | Extract the account export and select a message JSON file with `messages`, `sender_name`, `content` and `timestamp_ms`. Timestamps restore chronological order. Attachments without text are skipped. |
| PDF / DOCX / DOC | Extract readable text, detect labelled chat if present, otherwise split into text examples. Scanned/image-only PDFs need OCR before import. |
| CSV / TSV | Recognized paired/chat/text columns, parsed with quoted field and newline handling |
| Plain prose | Continued-language training on text chunks; Forge does not invent assistant answers from documents |

UTF-8, UTF-16 and common Windows text encodings are handled for text files. Files are limited to 32 MiB, and PDF extraction is limited to 1,000 pages. Instagram HTML is UTF-8, with an 8 MiB limit per page and a 32 MiB limit for the selected chat. Forge reads only that chat's message pages from a ZIP. Extraction can lose tables and layout. Unsupported schemas, empty files and canonical incomplete user-only conversations are rejected with a preprocessing message. Inspect the preview, roles and mode before training. Named participants are never assigned roles by speaking order. For group chats, other participants' names remain in incoming context.

For named chats, choose the **AI / Assistant** whose replies Forge should learn. In a two-person chat, the other speaker is **User**. In a group, select which other speakers provide user context. Everyone else starts checked. Unchecked speakers' messages are omitted, and Forge starts a new context window after each gap. The ZIP picker remembers each thread's roles while the current import is open.

Each example ends in a reply from the AI participant. Incoming turns and earlier replies provide context, and only that final reply receives training loss. Opening replies without incoming context and unanswered trailing messages are excluded and reported. Up to 12 recent turns and approximately 6,000 characters provide context. Original source files are unchanged. The preview shows the original file sample and up to three original/prepared comparisons. Changing the source, thread, or role assignments clears confirmation. Training checks source and prepared-data hashes to use exactly the reviewed dataset.

Normalization is shared across models. **Tokenization uses the selected model's tokenizer and chat template.** Canonical role-labelled chat datasets learn assistant replies only; incoming messages are masked from the loss. Unsupported template/tokenizer reply boundaries fail explicitly before allocating the base model. Text documents produce continued-language examples using all text, rather than invented question/answer pairs. Vision attachments, OCR and multimodal training are not supported by this trainer.

## Controls and checkpoints

Advanced training settings include learning rate, epochs/step cap, batch size, gradient accumulation, sequence length, LoRA rank and checkpoint interval. Long chat examples retain the most recent tokens so replies survive truncation. A selected reply too long to retain incoming context is rejected: increase the sequence length or split that reply. Prose retains its first tokens up to the limit. Start small and inspect the loss/progress; more steps do not guarantee better responses.

- **Pause** requests a checkpoint at an optimizer-step boundary. It may take time to finish the current step.
- **Resume** restores the latest completed adapter, optimizer and random-state checkpoint. It requires the same local base, tokenizer and prepared data.
- **Cancel** terminates the worker and its children. Resume is possible from a completed checkpoint; work since that checkpoint is lost. Cancellation before the first checkpoint has nothing to resume.
- Restart recovery marks an unfinished run as interrupted and permits checkpoint resume.

## Named adapters, conversion and stacking

After training, select **Use this LoRA** beside the saved adapter. Choose and confirm the GGUF made from the exact original base weights; matching architecture alone is insufficient. The guided flow unloads the current model if needed, converts the PEFT adapter, saves its selection, loads the matching base and verifies the adapter is active before offering **Start chatting**. Other selected adapters are retained by default; you can choose to replace those for the same base. Memory checks remain enabled. Cancel setup stops conversion or a model load started by this flow, after the current setup request returns; a runtime installation already in progress must finish its setup step. Completed files and saved selections are retained. A failed load leaves the selection available for retry. Model files are never rewritten.

Completed adapters are copied into `trained/<name>--<id>/` under Forge's data folder. Name the run before starting, or rename the library entry afterward. The folder retains PEFT weights/configuration; checkpoints remain under `training/<job-id>/`. Open trained storage from the UI.

To apply an adapter to llama.cpp:

1. Keep the original Hugging Face base used in training.
2. Add the **matching base GGUF** to the model library. A similar model name is not sufficient; architecture and base weights must match.
3. Use Convert in the trained library. Forge obtains the official llama.cpp converter and dependencies, then converts the PEFT adapter into a GGUF LoRA. Initial conversion needs internet access and the training Python environment.
4. Associate the result with the exact base GGUF. Enable one or more library adapters and choose their scales.
5. Load/reload that base model to preload selected adapters. Active preloaded scales can be changed or disabled without retraining. Newly added adapters require a reload.

Up to eight compatible adapters can be stacked with scales from 0 to 2. Stacking effects are model-dependent and can reduce quality. Removing an entry disables/removes its registration but preserves its files. Do not apply an adapter to an unrelated base. To create a missing GGUF base, use Models → Convert a Hugging Face model to GGUF with the original Hugging Face base folder. Base-model conversion uses its own Python environment; adapter conversion continues to use the training environment.
