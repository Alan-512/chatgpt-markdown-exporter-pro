const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const injectScript = fs.readFileSync(
  path.join(__dirname, '..', 'inject.js'),
  'utf8'
);

const TOKEN = 'test-token';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

function createResponse(body) {
  return {
    clone() {
      return {
        text: async () => body,
        json: async () => ({})
      };
    }
  };
}

test('emits a conversation ID from a ChatGPT conversation stream response', async () => {
  const messages = [];
  const response = createResponse(
    `data: {"conversation_id":"${CONVERSATION_ID}","message":{"id":"message-1"}}\n\ndata: [DONE]\n`
  );
  const window = {
    location: {
      hostname: 'chatgpt.com',
      origin: 'https://chatgpt.com'
    },
    fetch: async () => response,
    postMessage(message) {
      messages.push(message);
    },
    addEventListener() {}
  };

  vm.runInNewContext(injectScript, {
    window,
    document: { currentScript: { dataset: { token: TOKEN } } },
    Headers,
    URL,
    console: { log() {}, error() {} },
    setTimeout,
    clearTimeout
  }, { filename: 'inject.js' });

  await window.fetch('/backend-api/conversation', { method: 'POST' });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'OAI_CONVERSATION_ID');
  assert.equal(messages[0].conversationId, CONVERSATION_ID);
  assert.equal(messages[0].token, TOKEN);
});
