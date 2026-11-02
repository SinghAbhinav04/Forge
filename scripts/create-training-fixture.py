import json,sys
from pathlib import Path
from transformers import GPT2Config,GPT2LMHeadModel,PreTrainedTokenizerFast
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Whitespace
root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
base=root/'base'; base.mkdir(exist_ok=True)
words=['[PAD]','[UNK]','[EOS]','Forge','is','a','helpful','local','assistant','that','writes','documents','.']
backend=Tokenizer(WordLevel({word:i for i,word in enumerate(words)},unk_token='[UNK]')); backend.pre_tokenizer=Whitespace()
tokenizer=PreTrainedTokenizerFast(tokenizer_object=backend,pad_token='[PAD]',eos_token='[EOS]',unk_token='[UNK]')
tokenizer.chat_template="{% for m in messages %}{{ m['role'] + ': ' + m['content'] + (' [EOS]' if m['role'] == 'assistant' else '') + '\\n' }}{% endfor %}{% if add_generation_prompt %}{{ 'assistant: ' }}{% endif %}"
tokenizer.save_pretrained(base)
model=GPT2LMHeadModel(GPT2Config(vocab_size=len(words),n_positions=64,n_embd=32,n_layer=2,n_head=2,pad_token_id=0,eos_token_id=2,bos_token_id=2))
model.save_pretrained(base)
with open(root/'samples.jsonl','w',encoding='utf-8') as f:
    for i in range(128): f.write(json.dumps({'text':'Forge is a helpful local assistant that writes documents .'})+'\n')
with open(root/'chat.json','w',encoding='utf-8') as f:
    json.dump([{'messages':[{'sender':'Alice','text':'Forge is a local assistant .'}, {'sender':'Bob','text':'Forge is a helpful local assistant that writes documents .'}]} for _ in range(128)],f)
print('Created tiny local training fixture:',root)
