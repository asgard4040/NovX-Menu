import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AI_MODEL, firstModelForProvider, openAIResponseText, providerForAIModel } from './ai-models';

test('saved model selects the matching provider without accepting arbitrary models', () => {
  assert.equal(providerForAIModel(DEFAULT_AI_MODEL), 'gemini');
  assert.equal(providerForAIModel('gpt-5.6-luna'), 'openai');
  assert.equal(providerForAIModel('gpt-5.6-terra'), 'openai');
  assert.equal(providerForAIModel('other-model'), null);
  assert.equal(firstModelForProvider('gemini'), DEFAULT_AI_MODEL);
  assert.equal(firstModelForProvider('openai'), 'gpt-5.6-luna');
});

test('OpenAI text extraction ignores non-message and non-text output', () => {
  assert.equal(openAIResponseText({ output: [
    { type: 'reasoning', content: [{ type: 'output_text', text: 'hidden' }] },
    { type: 'message', content: [{ type: 'output_text', text: 'Try the kebab.' }] },
  ] }), 'Try the kebab.');
  assert.equal(openAIResponseText({ output: [] }), '');
});
