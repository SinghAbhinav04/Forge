import json,sys
from pathlib import Path
import sentencepiece as spm
from transformers import LlamaConfig,LlamaForCausalLM,LlamaTokenizer
root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True); base=root/'base'; base.mkdir(exist_ok=True)
corpus=root/'corpus.txt'; corpus.write_text(('Forge is a helpful local assistant that writes documents. Hello world.\n'*200),encoding='utf-8')
spm.SentencePieceTrainer.train(input=str(corpus),model_prefix=str(root/'tokenizer'),vocab_size=320,hard_vocab_limit=False,character_coverage=1.0,pad_id=3,byte_fallback=True)
tokenizer=LlamaTokenizer(vocab_file=str(root/'tokenizer.model'),model_max_length=128)
tokenizer.chat_template="{% for message in messages %}{{ bos_token + message['role'] + ': ' + message['content'] + eos_token }}{% endfor %}{% if add_generation_prompt %}{{ bos_token + 'assistant: ' }}{% endif %}"
tokenizer.save_pretrained(base)
model=LlamaForCausalLM(LlamaConfig(vocab_size=len(tokenizer),hidden_size=32,intermediate_size=64,num_hidden_layers=2,num_attention_heads=4,num_key_value_heads=2,max_position_embeddings=128,bos_token_id=tokenizer.bos_token_id,eos_token_id=tokenizer.eos_token_id,pad_token_id=tokenizer.pad_token_id))
model.save_pretrained(base)
(root/'data.jsonl').write_text(''.join(json.dumps({'text':'Forge is a helpful local assistant that writes documents.'})+'\n' for _ in range(20)),encoding='utf-8')
print('Created local Llama fixture')
