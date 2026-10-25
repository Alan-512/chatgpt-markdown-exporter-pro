const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const injectScript = fs.readFileSync(path.join(__dirname, '..', 'inject.js'), 'utf8');
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

function installInjector(fetch, postMessage) {
  const messages = [];
  const window = {
    location: { hostname: 'chatgpt.com', origin: 'https://chatgpt.com' },
    fetch,
    postMessage(message) {
      if (postMessage) postMessage(message);
      messages.push(message);
    },
    addEventListener() {}
  };
  vm.runInNewContext(injectScript, {
    window, document: {}, crypto, Headers, URL, TextDecoder,
    console: { log() {}, error() {} }, setTimeout, clearTimeout
  }, { filename: 'inject.js' });
  return { window, messages };
}

test('preserves valid Fetch header inputs and the original request promise', async () => {
  for (const headers of [
    { Authorization: { toString: () => 'Bearer test-token' } },
    [['Authorization', 'Bearer test-token']],
    new Headers({ Authorization: 'Bearer test-token' }),
    (function* () { yield ['Authorization', 'Bearer test-token']; })()
  ]) {
    let calls = 0;
    const response = new Response('ok');
    const originalPromise = Promise.resolve(response);
    const { window } = installInjector((url, options) => {
      calls += 1;
      assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-token');
      return originalPromise;
    });
    const result = window.fetch('/backend-api/f/conversation', { method: 'POST', headers });
    assert.equal(await result, response);
    assert.equal(result, originalPromise);
    assert.equal(calls, 1);
  }
});

test('an exporter message failure cannot stop a ChatGPT request', async () => {
  let calls = 0;
  const response = new Response('ok');
  const { window } = installInjector(async () => {
    calls += 1;
    return response;
  }, message => {
    if (message.type === 'OAI_CONVERSATION_ID') throw new Error('Exporter messaging unavailable');
  });
  const result = await window.fetch('/backend-api/f/conversation', {
    method: 'POST', body: JSON.stringify({ conversation_id: CONVERSATION_ID })
  });
  assert.equal(result, response);
  assert.equal(calls, 1);
  assert.equal(await result.text(), 'ok');
});

test('passes through network errors and aborts without changing their identity', async () => {
  for (const error of [new TypeError('Network unavailable'), new DOMException('Cancelled', 'AbortError')]) {
    const originalPromise = Promise.reject(error);
    const { window } = installInjector(() => originalPromise);
    const result = window.fetch('/backend-api/f/conversation', { method: 'POST' });
    await assert.rejects(result, actual => actual === error);
    assert.equal(result, originalPromise);
  }
});

test('detects a split streaming conversation ID before EOF and releases the observation branch', async () => {
  const encoder = new TextEncoder();
  let controller;
  let sourceCancelled = false;
  const source = new ReadableStream({
    start(value) { controller = value; },
    cancel() { sourceCancelled = true; }
  });
  const response = new Response(source, { headers: { 'Content-Type': 'text/event-stream' } });
  const { window, messages } = installInjector(async () => response);
  const received = await window.fetch('/backend-api/f/conversation', { method: 'POST' });
  assert.equal(received, response);
  const reader = received.body.getReader();
  try {
    for (const text of ['data: {"convers', `ation_id":"${CONVERSATION_ID.slice(0, 12)}`, `${CONVERSATION_ID.slice(12)}"}\n\n`]) {
      controller.enqueue(encoder.encode(text));
      const chunk = await reader.read();
      assert.equal(new TextDecoder().decode(chunk.value), text);
      if (!text.includes('"}')) {
        assert.equal(messages.filter(message => message.type === 'OAI_CONVERSATION_ID').length, 0, 'a partial ID must not be emitted');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(messages.some(message => message.conversationId === CONVERSATION_ID), 'ID must arrive while the reply is still streaming');
    const cancelled = await Promise.race([
      reader.cancel().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100))
    ]);
    assert.equal(cancelled, true, 'page cancellation must not wait for the exporter to read to EOF');
    assert.equal(sourceCancelled, true);
  } finally {
    if (!sourceCancelled) controller.close();
    reader.releaseLock();
  }
});

test('does not read or clone historical ChatGPT payloads before an export is requested', async () => {
  const response = new Response(JSON.stringify({ conversation_id: CONVERSATION_ID }));
  let clones = 0;
  const clone = response.clone.bind(response);
  response.clone = () => { clones += 1; return clone(); };
  const { window, messages } = installInjector(async () => response);
  const received = await window.fetch(`/backend-api/conversation/${CONVERSATION_ID}?current_node=latest`);
  assert.equal(clones, 0);
  assert.ok(messages.some(message => message.conversationId === CONVERSATION_ID));
  assert.equal((await received.json()).conversation_id, CONVERSATION_ID);
});

for (const ending of ['conversation ID', 'DONE', 'abort']) {
  test(`page cancellation completes with an open reply stream after ${ending}`, async () => {
    let controller;
    let sourceCancelled = false;
    const source = new ReadableStream({
      start(value) { controller = value; },
      cancel() { sourceCancelled = true; }
    });
    const response = new Response(source);
    const abort = new AbortController();
    const { window } = installInjector(async () => response);
    const received = await window.fetch('/backend-api/f/conversation', { method: 'POST', signal: abort.signal });
    const reader = received.body.getReader();
    try {
      const text = ending === 'conversation ID'
        ? `data: {"conversation_id":"${CONVERSATION_ID}"}\n\n`
        : ending === 'DONE' ? 'data: [DONE]\n\n' : 'event: ping\n\n';
      controller.enqueue(new TextEncoder().encode(text));
      assert.equal(new TextDecoder().decode((await reader.read()).value), text);
      if (ending === 'abort') abort.abort();
      const cancelled = await Promise.race([
        reader.cancel().then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 100))
      ]);
      assert.equal(cancelled, true, 'the exporter must not keep a cancelled reply alive');
      assert.equal(sourceCancelled, true);
    } finally {
      if (!sourceCancelled) controller.close();
      reader.releaseLock();
    }
  });
}

test('forwards a native Request body, signal and response unchanged', async () => {
  const abort = new AbortController();
  const body = JSON.stringify({ conversation_id: CONVERSATION_ID, messages: ['hello'] });
  const request = new Request('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST', headers: new Headers({ Authorization: 'Bearer request-token' }),
    body, signal: abort.signal
  });
  const response = new Response('data: [DONE]\n\n');
  const { window, messages } = installInjector(async received => {
    assert.equal(received, request);
    assert.equal(received.signal.aborted, false);
    assert.equal(await received.text(), body);
    return response;
  });
  assert.equal(await window.fetch(request), response);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(messages.some(message => message.conversationId === CONVERSATION_ID));
  assert.equal(await response.text(), 'data: [DONE]\n\n');
});
