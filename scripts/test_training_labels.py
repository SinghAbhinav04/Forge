"""Regression checks for reply-only labels using a real local fast tokenizer."""
import unittest
from train_lora import encode_example, encode_batch
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Whitespace
from transformers import PreTrainedTokenizerFast

class ReplyLabels(unittest.TestCase):
    def setUp(self):
        words = ['[PAD]', '[UNK]', '[EOS]', 'user', 'assistant', ':', 'incoming', 'oldreply', 'next', 'target']
        backend = Tokenizer(WordLevel({word: i for i, word in enumerate(words)}, unk_token='[UNK]'))
        backend.pre_tokenizer = Whitespace()
        self.tokenizer = PreTrainedTokenizerFast(tokenizer_object=backend, pad_token='[PAD]', eos_token='[EOS]', unk_token='[UNK]')
        self.tokenizer.chat_template = "{% for m in messages %}{{ m['role'] + ': ' + m['content'] + (' [EOS]' if m['role'] == 'assistant' else '') + '\\n' }}{% endfor %}{% if add_generation_prompt %}{{ 'assistant: ' }}{% endif %}"
        self.row = {'messages': [{'role': 'user', 'content': 'incoming'}, {'role': 'assistant', 'content': 'oldreply'}, {'role': 'user', 'content': 'next'}, {'role': 'assistant', 'content': 'target'}], 'target_last_reply': True}

    def learned(self, result):
        return [self.tokenizer.convert_ids_to_tokens(label) for label in result['labels'] if label != -100]

    def test_only_chosen_final_reply_is_learned(self):
        result = encode_example(self.tokenizer, self.row, 64)
        self.assertEqual(self.learned(result), ['target', '[EOS]'])
        self.assertIn(self.tokenizer.convert_tokens_to_ids('incoming'), result['input_ids'])

    def test_canonical_chat_learns_all_assistant_replies(self):
        row = dict(self.row, target_last_reply=False)
        self.assertEqual(self.learned(encode_example(self.tokenizer, row, 64)), ['oldreply', '[EOS]', 'target', '[EOS]'])

    def test_truncation_preserves_reply_and_padding_has_no_loss(self):
        result = encode_example(self.tokenizer, self.row, 6)
        self.assertEqual(self.learned(result), ['target', '[EOS]'])
        batch = encode_batch(self.tokenizer, [self.row, {'text': 'incoming target'}], 64)
        self.assertTrue(bool((batch['labels'][batch['attention_mask'] == 0] == -100).all()))

    def test_unsafe_template_and_missing_targets_fail(self):
        with self.assertRaisesRegex(ValueError, 'no assistant reply'):
            encode_example(self.tokenizer, {'messages': [{'role': 'user', 'content': 'incoming'}]}, 64)
        self.tokenizer.chat_template = "{{ 'generation' if add_generation_prompt else 'different' }}"
        with self.assertRaisesRegex(ValueError, 'safely identify'):
            encode_example(self.tokenizer, self.row, 64)

if __name__ == '__main__':
    unittest.main()
