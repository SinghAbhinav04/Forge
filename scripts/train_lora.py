"""Local-only supervised LoRA training. Never modifies the base model."""
import json, math, os, sys, time
from pathlib import Path

def emit(kind, **values):
    print(json.dumps({"type": kind, **values}), flush=True)

def encode_example(tokenizer, row, max_length):
    """Build token labels from the actual model template; never guess role delimiters."""
    messages = row.get("messages")
    if messages is None:
        encoded = tokenizer(row["text"], truncation=True, max_length=max_length, add_special_tokens=True)
        ids = encoded["input_ids"]
        labels = list(ids)
    else:
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        spans = []
        for index, message in enumerate(messages):
            if message["role"] != "assistant" or (row.get("target_last_reply") and index != len(messages)-1):
                continue
            prefix = tokenizer.apply_chat_template(messages[:index], tokenize=False, add_generation_prompt=True)
            completed = tokenizer.apply_chat_template(messages[:index+1], tokenize=False, add_generation_prompt=False)
            if not text.startswith(prefix) or not text.startswith(completed) or len(completed) <= len(prefix):
                raise ValueError("This model's chat template cannot safely identify reply boundaries. Use a compatible chat tokenizer or preprocess the training data.")
            spans.append((len(prefix), len(completed)))
        if not spans:
            raise ValueError("Chat example has no assistant reply to learn")
        if getattr(tokenizer, "is_fast", False):
            encoded = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)
            ids = encoded["input_ids"]
            labels = [token if end > start and any(start >= a and end <= b for a, b in spans) else -100
                      for token, (start, end) in zip(ids, encoded["offset_mapping"])]
        else:
            ids = tokenizer(text, add_special_tokens=False)["input_ids"]
            labels = [-100] * len(ids)
            for start, end in spans:
                before = tokenizer(text[:start], add_special_tokens=False)["input_ids"]
                through = tokenizer(text[:end], add_special_tokens=False)["input_ids"]
                if ids[:len(before)] != before or ids[:len(through)] != through:
                    raise ValueError("This slow tokenizer merges tokens across reply boundaries. Use its fast tokenizer or preprocess the data.")
                labels[len(before):len(through)] = ids[len(before):len(through)]
        # Preserve the reply and most recent context instead of truncating the answer away.
        ids, labels = ids[-max_length:], labels[-max_length:]
        if row.get("target_last_reply") and labels and all(label != -100 for label in labels):
            raise ValueError("A selected-person reply exceeds the sequence length. Increase sequence length or split that reply before training.")
    if len(ids) < 2 or not any(label != -100 for label in labels[1:]):
        raise ValueError("No trainable reply tokens remain at this sequence length. Increase sequence length or preprocess the example.")
    return {"input_ids": ids, "labels": labels}

def encode_batch(tokenizer, rows, max_length):
    import torch
    examples = [row if "input_ids" in row and "labels" in row else encode_example(tokenizer, row, max_length) for row in rows]
    width = max(len(example["input_ids"]) for example in examples)
    return {
        "input_ids": torch.tensor([e["input_ids"] + [tokenizer.pad_token_id]*(width-len(e["input_ids"])) for e in examples]),
        "attention_mask": torch.tensor([[1]*len(e["input_ids"]) + [0]*(width-len(e["input_ids"])) for e in examples]),
        "labels": torch.tensor([e["labels"] + [-100]*(width-len(e["labels"])) for e in examples]),
    }

def train(config):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import LoraConfig, TaskType, get_peft_model, PeftModel
    torch.set_num_threads(2)
    torch.manual_seed(42)
    output = Path(config["output"])
    device = config["device"]
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable in this training engine")
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("Apple Metal is unavailable")
    emit("status", status="running")
    tokenizer = AutoTokenizer.from_pretrained(config["baseModel"], local_files_only=True, trust_remote_code=False)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    if tokenizer.pad_token_id is None:
        raise ValueError("Tokenizer must have a pad or EOS token")
    rows = []
    with open(config["dataset"], encoding="utf-8") as data:
        for line in data:
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row.get("messages"), list) and not (isinstance(row.get("text"), str) and row["text"].strip()):
                raise ValueError('Each JSONL row needs a nonempty "text" string or "messages" array')
            rows.append(row)
    if not rows:
        raise ValueError("The training dataset is empty")
    # Validate reply boundaries before allocating the base model.
    encoded_rows = [encode_example(tokenizer, row, config["maxLength"]) for row in rows]
    dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    emit("info", message=f"Loading model using {dtype}")
    model = AutoModelForCausalLM.from_pretrained(config["baseModel"], local_files_only=True, trust_remote_code=False, torch_dtype=dtype)
    checkpoint = None
    if config.get("resume"):
        checkpoint = json.loads((output / "latest.json").read_text())["path"]
        model = PeftModel.from_pretrained(model, checkpoint, is_trainable=True, local_files_only=True)
    else:
        model = get_peft_model(model, LoraConfig(task_type=TaskType.CAUSAL_LM, r=config["loraRank"], lora_alpha=config["loraRank"]*2, lora_dropout=0.05, target_modules="all-linear"))
    if config.get("gradientCheckpointing"):
        if not getattr(model, "supports_gradient_checkpointing", False):
            raise ValueError("This model does not support gradient checkpointing. Turn it off in advanced training settings.")
        model.gradient_checkpointing_enable()
        if hasattr(model, "enable_input_require_grads"):
            model.enable_input_require_grads()
    model.to(device)
    model.config.use_cache = False
    model.train()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=config["learningRate"])
    step = 0
    if checkpoint:
        saved = torch.load(Path(checkpoint) / "training_state.pt", map_location=device, weights_only=True)
        optimizer.load_state_dict(saved["optimizer"])
        step = saved["step"]
        torch.set_rng_state(saved["rng"].cpu())
        if device == "cuda" and saved.get("cuda_rng"):
            torch.cuda.set_rng_state_all([state.cpu() for state in saved["cuda_rng"]])
        if device == "mps" and saved.get("mps_rng") is not None:
            torch.mps.set_rng_state(saved["mps_rng"].cpu())
    batch = config["batchSize"]
    accumulation = config["gradientAccumulation"]
    total = min(config["maxSteps"], max(1, math.ceil(len(rows)*config["epochs"]/(batch*accumulation))))
    def save_checkpoint():
        folder = output / f"checkpoint-{step:06d}"
        folder.mkdir(exist_ok=True)
        model.save_pretrained(folder)
        tokenizer.save_pretrained(folder)
        torch.save({"step": step, "optimizer": optimizer.state_dict(), "rng": torch.get_rng_state(), "cuda_rng": torch.cuda.get_rng_state_all() if device == "cuda" else None, "mps_rng": torch.mps.get_rng_state() if device == "mps" else None}, folder / "training_state.pt")
        marker = output / "latest.tmp"
        marker.write_text(json.dumps({"path": str(folder), "step": step}))
        os.replace(marker, output / "latest.json")
        emit("checkpoint", path=str(folder), step=step)
    while step < total:
        optimizer.zero_grad(set_to_none=True)
        loss_value = 0
        for micro in range(accumulation):
            selected = [encoded_rows[((step*accumulation+micro)*batch+i) % len(encoded_rows)] for i in range(batch)]
            encoded = encode_batch(tokenizer, selected, config["maxLength"])
            inputs = {key: encoded[key].to(device) for key in ["input_ids", "attention_mask"]}
            labels = encoded["labels"].to(device)
            loss = model(**inputs, labels=labels).loss / accumulation
            if not torch.isfinite(loss):
                raise RuntimeError("Non-finite loss; reduce learning rate or choose a different base model")
            loss.backward()
            loss_value += float(loss.detach())
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        step += 1
        emit("progress", step=step, totalSteps=total, loss=loss_value)
        try:
            control = json.loads((output / "control.json").read_text())
        except (OSError, ValueError):
            control = {}
        pause = control.get("action") == "pause"
        if step % config["saveEvery"] == 0 or step == total or pause:
            save_checkpoint()
        if pause:
            emit("status", status="paused")
            return
    model.save_pretrained(output / "adapter")
    tokenizer.save_pretrained(output / "adapter")
    emit("status", status="completed")

if __name__ == "__main__":
    try:
        train(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except Exception as error:
        emit("error", message=str(error))
        raise
