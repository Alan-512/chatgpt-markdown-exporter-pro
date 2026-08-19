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
const GEMINI_CONVERSATION_ID = 'c_77ab2f6b9faa3039';
const GEMINI_DOM_FALLBACK_ID = '__gemini_temp_dom__';

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

test('emits a conversation ID from the current ChatGPT f/conversation endpoint', async () => {
  const messages = [];
  const response = createResponse(
    `data: {\\"conversation_id\\":\\"${CONVERSATION_ID}\\"}\n\ndata: [DONE]\n`
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

  await window.fetch('/backend-api/f/conversation', { method: 'POST' });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversationId, CONVERSATION_ID);
});

test('emits a conversation ID when ChatGPT passes a Request-like POST object', async () => {
  const messages = [];
  const response = createResponse(
    `data: {"conversationId":"${CONVERSATION_ID}"}\n\ndata: [DONE]\n`
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

  await window.fetch({
    url: '/backend-api/conversation?temporary=true',
    method: 'POST'
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversationId, CONVERSATION_ID);
});

test('emits a conversation ID from a ChatGPT backend request body', async () => {
  const messages = [];
  const response = createResponse('{}');
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

  await window.fetch('/backend-api/moderations', {
    method: 'POST',
    body: `conversation_id=${CONVERSATION_ID}`
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversationId, CONVERSATION_ID);
});

test('emits a conversation ID from a ChatGPT conversation GET request', async () => {
  const messages = [];
  const response = createResponse('{}');
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

  await window.fetch(`/backend-api/conversation/${CONVERSATION_ID}`, { method: 'GET' });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'OAI_CONVERSATION_ID');
  assert.equal(messages[0].conversationId, CONVERSATION_ID);
  assert.equal(messages[0].token, TOKEN);
});

test('recovers the visible ChatGPT assistant reply when a temporary payload is user-only', async () => {
  const messages = [];
  let messageHandler = null;
  const userNode = {
    textContent: 'hi',
    getAttribute(name) {
      return name === 'data-message-author-role' ? 'user' : null;
    },
    contains() { return false; },
    compareDocumentPosition() { return 4; }
  };
  const assistantNode = {
    textContent: 'Hi! How can I help?',
    getAttribute(name) {
      return name === 'data-message-author-role' ? 'assistant' : null;
    },
    contains() { return false; },
    compareDocumentPosition() { return 2; }
  };
  const partialPayload = {
    conversation_id: CONVERSATION_ID,
    title: 'Temporary Chat',
    current_node: 'user-node',
    mapping: {
      root: { id: 'root', parent: null, message: null },
      'user-node': {
        id: 'user-node',
        parent: 'root',
        message: {
          id: 'user-message',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['hi'] }
        }
      }
    }
  };
  const document = {
    currentScript: { dataset: { token: TOKEN } },
    title: 'ChatGPT',
    querySelectorAll(selector) {
      if (selector.includes('data-message-author-role="user"')) return [userNode];
      if (selector.includes('data-message-author-role="assistant"')) return [assistantNode];
      return [];
    }
  };
  const response = {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => partialPayload
  };
  const window = {
    location: {
      hostname: 'chatgpt.com',
      pathname: '/',
      search: '?temporary-chat=true',
      href: `https://chatgpt.com/?temporary-chat=true`,
      origin: 'https://chatgpt.com'
    },
    fetch: async url => (
      url === '/api/auth/session'
        ? { ok: true, json: async () => ({ accessToken: 'session-token' }) }
        : response
    ),
    postMessage(message) {
      messages.push(message);
    },
    addEventListener(type, callback) {
      if (type === 'message') messageHandler = callback;
    }
  };

  vm.runInNewContext(injectScript, {
    window,
    document,
    Headers,
    URL,
    console: { log() {}, error() {} },
    setTimeout,
    clearTimeout
  }, { filename: 'inject.js' });

  await messageHandler({
    source: window,
    origin: window.location.origin,
    data: {
      type: 'OAI_EXPORT_REQUEST',
      conversationId: CONVERSATION_ID,
      platform: 'chatgpt',
      requestId: 'chatgpt-dom-request',
      token: TOKEN
    }
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].success, true);
  assert.equal(messages[0].data.extraction, 'dom');
  const currentMessage = messages[0].data.mapping[messages[0].data.current_node].message;
  assert.equal(currentMessage.author.role, 'assistant');
  assert.equal(currentMessage.content.parts[0], 'Hi! How can I help?');
});

test('emits a Gemini conversation ID from a batchexecute response', async () => {
  const messages = [];
  const response = createResponse(
    `[["wrb.fr","hNvQHb","[[\"${GEMINI_CONVERSATION_ID}\"]]",null,null,null,"generic"]]`
  );
  const window = {
    location: {
      hostname: 'gemini.google.com',
      origin: 'https://gemini.google.com'
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

  await window.fetch('/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&source-path=%2Fapp', {
    method: 'POST',
    body: 'f.req=test'
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'OAI_CONVERSATION_ID');
  assert.equal(messages[0].conversationId, GEMINI_CONVERSATION_ID);
  assert.equal(messages[0].platform, 'gemini');
  assert.equal(messages[0].token, TOKEN);
});

test('emits a Gemini conversation ID from a StreamGenerate response', async () => {
  const messages = [];
  const response = createResponse(
    `[["wrb.fr","StreamGenerate","[[null,[\"${GEMINI_CONVERSATION_ID}\"]]]",null,null,null,"generic"]]`
  );
  const window = {
    location: {
      hostname: 'gemini.google.com',
      origin: 'https://gemini.google.com'
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

  await window.fetch('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?source-path=%2Fapp', {
    method: 'POST',
    body: 'f.req=test'
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversationId, GEMINI_CONVERSATION_ID);
  assert.equal(messages[0].platform, 'gemini');
});

test('does not use the first Gemini sidebar conversation as the active chat ID', async () => {
  const messages = [];
  const response = createResponse(
    `[["wrb.fr","MaZiqc","[[\"c_first-sidebar-chat\"]]",null,null,null,"generic"]]`
  );
  const window = {
    location: {
      hostname: 'gemini.google.com',
      origin: 'https://gemini.google.com'
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

  await window.fetch('/_/BardChatUi/data/batchexecute?rpcids=MaZiqc&source-path=%2Fapp', {
    method: 'POST',
    body: 'f.req=test'
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(messages.length, 0);
});

test('exports the current Gemini temporary DOM when no conversation ID exists', async () => {
  const messages = [];
  let messageHandler = null;
  const userNode = {
    tagName: 'USER-QUERY',
    textContent: 'hi',
    getAttribute(name) {
      return name === 'data-message-author-role' ? 'user' : null;
    },
    contains() { return false; },
    compareDocumentPosition() { return 4; }
  };
  const assistantNode = {
    tagName: 'MODEL-RESPONSE',
    textContent: 'Hello! How can I help you today?',
    getAttribute(name) {
      return name === 'data-message-author-role' ? 'assistant' : null;
    },
    contains() { return false; },
    compareDocumentPosition() { return 2; }
  };
  const document = {
    currentScript: { dataset: { token: TOKEN } },
    title: 'Gemini',
    querySelectorAll(selector) {
      if (selector.includes('user-query')) return [userNode];
      if (selector.includes('model-response')) return [assistantNode];
      return [];
    }
  };
  const window = {
    location: {
      hostname: 'gemini.google.com',
      pathname: '/app',
      origin: 'https://gemini.google.com'
    },
    fetch: async () => ({ ok: false }),
    postMessage(message) {
      messages.push(message);
    },
    addEventListener(type, callback) {
      if (type === 'message') messageHandler = callback;
    }
  };

  vm.runInNewContext(injectScript, {
    window,
    document,
    Headers,
    URL,
    console: { log() {}, error() {} },
    setTimeout,
    clearTimeout
  }, { filename: 'inject.js' });

  await messageHandler({
    source: window,
    origin: window.location.origin,
    data: {
      type: 'OAI_EXPORT_REQUEST',
      conversationId: GEMINI_DOM_FALLBACK_ID,
      platform: 'gemini',
      requestId: 'dom-request',
      token: TOKEN
    }
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].success, true);
  assert.equal(messages[0].data.extraction, 'dom');
  assert.equal(JSON.stringify(messages[0].data.blocks), JSON.stringify([{
    userText: 'hi',
    assistantText: 'Hello! How can I help you today?',
    thoughtsText: null,
    tsPair: null
  }]));
});

test('emits a Claude conversation ID from a conversation API request', async () => {
  const messages = [];
  const response = createResponse('{}');
  const window = {
    location: {
      hostname: 'claude.ai',
      origin: 'https://claude.ai'
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

  await window.fetch(`/api/organizations/${CONVERSATION_ID}/chat_conversations/${CONVERSATION_ID}/messages`, {
    method: 'POST',
    body: '{}'
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversationId, CONVERSATION_ID);
  assert.equal(messages[0].platform, 'claude');
});

test('emits a Perplexity conversation ID from a thread response', async () => {
  const messages = [];
  const response = createResponse('{"threadId":"temporary-thread-123"}');
  const window = {
    location: {
      hostname: 'www.perplexity.ai',
      origin: 'https://www.perplexity.ai'
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

  await window.fetch('/api/threads', { method: 'POST', body: '{}' });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversationId, 'temporary-thread-123');
  assert.equal(messages[0].platform, 'perplexity');
});
