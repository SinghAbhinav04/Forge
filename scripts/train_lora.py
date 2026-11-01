"""Local-only supervised LoRA training. Never modifies the base model."""
import json, math, os, sys, time
from pathlib import Path

def emit(kind, **values):
    print(json.dumps({"type": kind, **values}), flush=True)

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
            text = row.get("text")
            if text is None and isinstance(row.get("messages"), list):
                text = tokenizer.apply_chat_template(row["messages"], tokenize=False, add_generation_prompt=False)
            if not isinstance(text, str) or not text.strip():
                raise ValueError('Each JSONL row needs a nonempty "text" string or "messages" array')
            rows.append(text)
    if not rows:
        raise ValueError("The training dataset is empty")
    model = AutoModelForCausalLM.from_pretrained(config["baseModel"], local_files_only=True, trust_remote_code=False, torch_dtype=torch.float32)
    checkpoint = None
    if config.get("resume"):
        checkpoint = json.loads((output / "latest.json").read_text())["path"]
        model = PeftModel.from_pretrained(model, checkpoint, is_trainable=True, local_files_only=True)
    else:
        model = get_peft_model(model, LoraConfig(task_type=TaskType.CAUSAL_LM, r=config["loraRank"], lora_alpha=config["loraRank"]*2, lora_dropout=0.05, target_modules="all-linear"))
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
            selected = [rows[((step*accumulation+micro)*batch+i) % len(rows)] for i in range(batch)]
            encoded = tokenizer(selected, truncation=True, max_length=config["maxLength"], padding="max_length", return_tensors="pt")
            if any(int(mask.sum()) < 2 for mask in encoded["attention_mask"]):
                raise ValueError("Training samples need at least two tokens")
            inputs = {key: encoded[key].to(device) for key in ["input_ids", "attention_mask"]}
            labels = inputs["input_ids"].clone()
            labels[inputs["attention_mask"] == 0] = -100
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
