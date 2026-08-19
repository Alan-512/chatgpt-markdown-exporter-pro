const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const contentScript = fs.readFileSync(
  path.join(__dirname, '..', 'content.js'),
  'utf8'
);

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const TEMPORARY_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const CLAUDE_TEMPORARY_ID = '33333333-3333-4333-8333-333333333333';
const GEMINI_TEMPORARY_ID = 'gemini-temp-chat-1';
const PERPLEXITY_TEMPORARY_ID = 'temporary-thread-1';
const SECURE_TOKEN = '00000000-0000-4000-8000-000000000000';

function createNode() {
  const listeners = new Map();
  const children = new Map();
  return {
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() { return true; }
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    contains() { return false; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, createNode());
      return children.get(selector);
    },
    click() {
      const callback = listeners.get('click');
      callback?.({ stopPropagation() {} });
    },
    remove() {}
  };
}

function loadContentScript(pathname, {
  hostname = 'chatgpt.com',
  temporaryConversationId = null,
  temporaryConversationAttribute = 'data-conversation-id',
  temporaryMode = null,
  temporaryModeTagName = 'div'
} = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const intervalCallbacks = [];
  let mountedContainer = null;
  let appendCount = 0;
  const postedMessages = [];
  let clipboardText = null;
  let temporaryConversationLabel = temporaryConversationId
    ? `对话 chat-${temporaryConversationId}`
    : null;
  let temporaryModeLabel = temporaryMode;
  const initialPathname = pathname.split('?')[0];

  const location = {
    href: `https://${hostname}${pathname}`,
    pathname: initialPathname,
    search: pathname.includes('?') ? pathname.slice(pathname.indexOf('?')) : '',
    hostname,
    origin: `https://${hostname}`
  };

  const document = {
    readyState: 'loading',
    body: null,
    head: null,
    documentElement: { appendChild() {} },
    createElement() { return createNode(); },
    getElementById(id) {
      return mountedContainer && mountedContainer.id === id
        ? mountedContainer
        : null;
    },
    querySelectorAll(selector) {
      const nodes = [];
      const modeSelector = /incognito|temporary|临时|隐身|无痕|role="status"|role="banner"|role="heading"|header|(?:^|\s)h[1-3](?:\s|,|$)|main h[12]|button/.test(selector);
      const conversationSelector = /data-conversation-id|data-chat-id|data-thread-id|chat-|href\*="\/(?:chat|app|gem|search|page)\//.test(selector);
      if (temporaryModeLabel && modeSelector) {
        nodes.push({
          tagName: temporaryModeTagName,
          textContent: temporaryModeLabel,
          getAttribute(name) {
            return [
              'aria-label', 'data-testid', 'data-test-id', 'data-tooltip',
              'title', 'placeholder'
            ].includes(name)
              ? temporaryModeLabel
              : null;
          }
        });
      }
      if (temporaryConversationLabel && conversationSelector) {
        nodes.push({
          textContent: temporaryConversationLabel,
          getAttribute(name) {
            const value = name === temporaryConversationAttribute
              ? temporaryConversationId
              : (name === 'aria-label' ? temporaryConversationLabel : null);
            return value;
          }
        });
      }
      return nodes;
    },
    addEventListener(type, callback, options = {}) {
      const listeners = documentListeners.get(type) || [];
      listeners.push({ callback, once: options.once === true });
      documentListeners.set(type, listeners);
    }
  };

  const window = {
    location,
    addEventListener(type, callback) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(callback);
      windowListeners.set(type, listeners);
    },
    postMessage(message) {
      postedMessages.push(message);
    }
  };
  window.window = window;

  vm.runInNewContext(contentScript, {
    window,
    location,
    document,
    chrome: {
      runtime: {
        getURL: name => `chrome-extension://test/${name}`
      }
    },
    crypto: {
      randomUUID: () => '00000000-0000-4000-8000-000000000000'
    },
    navigator: {
      clipboard: {
        writeText: async text => {
          clipboardText = text;
        }
      }
    },
    console,
    Blob: class {},
    URL,
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    setTimeout() { return 1; },
    clearTimeout() {}
  }, { filename: 'content.js' });

  function dispatchDocumentEvent(type) {
    const listeners = documentListeners.get(type) || [];
    documentListeners.set(
      type,
      listeners.filter(listener => !listener.once)
    );
    for (const listener of listeners) {
      listener.callback();
    }
  }

  return {
    makeDomReady() {
      document.readyState = 'interactive';
      document.body = {
        appendChild(node) {
          mountedContainer = node;
          appendCount += 1;
        },
        removeChild() {}
      };
      dispatchDocumentEvent('DOMContentLoaded');
    },
    navigate(nextPathname) {
      location.pathname = nextPathname.split('?')[0];
      location.href = `https://${hostname}${nextPathname}`;
      location.search = nextPathname.includes('?')
        ? nextPathname.slice(nextPathname.indexOf('?'))
        : '';
      for (const callback of intervalCallbacks) callback();
    },
    setTemporaryConversationId(nextId) {
      temporaryConversationId = nextId;
      temporaryConversationLabel = nextId ? `对话 chat-${nextId}` : null;
    },
    setTemporaryMode(nextMode) {
      temporaryModeLabel = nextMode;
    },
    receiveWindowMessage(data) {
      const listeners = windowListeners.get('message') || [];
      const event = {
        source: window,
        origin: location.origin,
        data
      };
      for (const callback of listeners) callback(event);
    },
    poll() {
      for (const callback of intervalCallbacks) callback();
    },
    get appendCount() {
      return appendCount;
    },
    click(selector) {
      mountedContainer?.querySelector(selector)?.click();
    },
    get postedMessages() {
      return postedMessages;
    },
    get clipboardText() {
      return clipboardText;
    }
  };
}

test('mounts the export UI after DOM readiness on a direct conversation load', () => {
  const page = loadContentScript(`/c/${CONVERSATION_ID}`);

  page.makeDomReady();

  assert.equal(page.appendCount, 1);
});

test('mounts the export UI after SPA navigation into a conversation', () => {
  const page = loadContentScript('/');
  page.makeDomReady();

  page.navigate(`/c/${CONVERSATION_ID}`);

  assert.equal(page.appendCount, 1);
});

test('mounts the export UI for a temporary chat using its DOM conversation ID', () => {
  const page = loadContentScript('/?temporary-chat=true', {
    temporaryConversationId: TEMPORARY_CONVERSATION_ID
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 1);
});

test('mounts ChatGPT temporary chat from the active toggle label', () => {
  const page = loadContentScript('/', {
    temporaryMode: 'Turn off temporary chat',
    temporaryModeTagName: 'button',
    temporaryConversationId: TEMPORARY_CONVERSATION_ID
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 1);
});

test('mounts ChatGPT temporary chat from the Chinese composer marker', () => {
  const page = loadContentScript('/', {
    temporaryMode: '临时聊天',
    temporaryModeTagName: 'textarea',
    temporaryConversationId: TEMPORARY_CONVERSATION_ID
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 1);
});

test('keeps ChatGPT temporary chat visible before the network reveals its conversation ID', () => {
  const page = loadContentScript('/', {
    temporaryMode: '临时聊天',
    temporaryModeTagName: 'textarea'
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 1);

  page.receiveWindowMessage({
    type: 'OAI_CONVERSATION_ID',
    conversationId: TEMPORARY_CONVERSATION_ID,
    token: SECURE_TOKEN
  });

  assert.equal(page.appendCount, 1);
});

test('keeps a network conversation ID until the temporary marker renders', () => {
  const page = loadContentScript('/');

  page.makeDomReady();
  page.receiveWindowMessage({
    type: 'OAI_CONVERSATION_ID',
    conversationId: TEMPORARY_CONVERSATION_ID,
    token: SECURE_TOKEN
  });

  assert.equal(page.appendCount, 0);

  page.setTemporaryMode('临时聊天');
  page.poll();

  assert.equal(page.appendCount, 1);
});

test('mounts ChatGPT temporary chat from its conversationId query parameter', () => {
  const page = loadContentScript(
    `/?conversationId=${TEMPORARY_CONVERSATION_ID}&temporary-chat=true`
  );

  page.makeDomReady();

  assert.equal(page.appendCount, 1);
});

test('does not treat ChatGPT turn-on temporary toggle as active mode', () => {
  const page = loadContentScript('/', {
    temporaryMode: 'Turn on temporary chat',
    temporaryModeTagName: 'button',
    temporaryConversationId: TEMPORARY_CONVERSATION_ID
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 0);
});

test('does not treat ChatGPT Chinese turn-on toggle as active mode', () => {
  const page = loadContentScript('/', {
    temporaryMode: '开启临时聊天',
    temporaryModeTagName: 'button',
    temporaryConversationId: TEMPORARY_CONVERSATION_ID
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 0);
});

test('retries temporary chat UI mounting when its DOM conversation ID appears later', () => {
  const page = loadContentScript('/?temporary-chat=true');
  page.makeDomReady();

  assert.equal(page.appendCount, 1);

  page.setTemporaryConversationId(TEMPORARY_CONVERSATION_ID);
  page.poll();

  assert.equal(page.appendCount, 1);
});

test('does not mount the export UI on a non-conversation page', () => {
  const page = loadContentScript('/');

  page.makeDomReady();

  assert.equal(page.appendCount, 0);
});

test('does not use a DOM conversation ID outside temporary chat mode', () => {
  const page = loadContentScript('/', {
    temporaryConversationId: TEMPORARY_CONVERSATION_ID
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 0);
});

const VENDOR_TEMPORARY_CASES = [
  {
    hostname: 'claude.ai',
    privatePath: '/new?incognito',
    domPath: '/new',
    normalPath: `/chat/${CLAUDE_TEMPORARY_ID}`,
    mode: 'Incognito chat',
    inactiveMode: 'Start an incognito chat',
    id: CLAUDE_TEMPORARY_ID
  },
  {
    hostname: 'gemini.google.com',
    privatePath: '/app?temporary-chat=true',
    domPath: '/app',
    normalPath: `/app/${GEMINI_TEMPORARY_ID}`,
    mode: 'Temporary chat',
    inactiveMode: 'Start temporary chat',
    idAttribute: 'data-chat-id',
    id: GEMINI_TEMPORARY_ID
  },
  {
    hostname: 'www.perplexity.ai',
    privatePath: '/?incognito=true',
    domPath: '/',
    normalPath: `/search/${PERPLEXITY_TEMPORARY_ID}`,
    mode: 'Incognito',
    inactiveMode: 'Enable Incognito',
    idAttribute: 'data-thread-id',
    id: PERPLEXITY_TEMPORARY_ID
  }
];

function loadVendorCase(spec, {
  pathname = spec.privatePath,
  mode = spec.mode,
  id = spec.id,
  modeTagName = 'div'
} = {}) {
  return loadContentScript(pathname, {
    hostname: spec.hostname,
    temporaryMode: mode,
    temporaryModeTagName: modeTagName,
    temporaryConversationAttribute: spec.idAttribute,
    temporaryConversationId: id
  });
}

test('preserves normal vendor conversation route mounting', () => {
  for (const spec of VENDOR_TEMPORARY_CASES) {
    const page = loadVendorCase(spec, { pathname: spec.normalPath, mode: null, id: null });
    page.makeDomReady();
    assert.equal(page.appendCount, 1);
  }
});

test('mounts each vendor temporary chat using its DOM conversation ID', () => {
  for (const spec of VENDOR_TEMPORARY_CASES) {
    const page = loadVendorCase(spec);
    page.makeDomReady();
    assert.equal(page.appendCount, 1, spec.hostname);
  }
});

test('mounts each vendor temporary chat when only the active DOM mode is signaled', () => {
  for (const spec of VENDOR_TEMPORARY_CASES) {
    const page = loadVendorCase(spec, { pathname: spec.domPath });
    page.makeDomReady();
    assert.equal(page.appendCount, 1, spec.hostname);
  }
});

test('mounts Gemini temporary chat from its localized heading on the /app route', () => {
  const page = loadContentScript('/app', {
    hostname: 'gemini.google.com',
    temporaryMode: '临时对话',
    temporaryModeTagName: 'h1',
    temporaryConversationId: null
  });

  page.makeDomReady();

  assert.equal(page.appendCount, 1);
});

test('uses the Gemini DOM export sentinel instead of requiring an ID', () => {
  const page = loadContentScript('/app', {
    hostname: 'gemini.google.com',
    temporaryMode: '临时对话',
    temporaryModeTagName: 'h1',
    temporaryConversationId: null
  });

  page.makeDomReady();
  page.click('.btn-copy');

  assert.equal(page.postedMessages[0].type, 'OAI_EXPORT_REQUEST');
  assert.equal(page.postedMessages[0].conversationId, '__gemini_temp_dom__');
  assert.equal(page.postedMessages[0].platform, 'gemini');
});

test('keeps ChatGPT assistant replies when the temporary export returns a DOM payload', async () => {
  const page = loadContentScript('/?temporary-chat=true', {
    hostname: 'chatgpt.com',
    temporaryConversationId: TEMPORARY_CONVERSATION_ID
  });

  page.makeDomReady();
  page.receiveWindowMessage({
    type: 'OAI_CONVERSATION_ID',
    conversationId: TEMPORARY_CONVERSATION_ID,
    token: SECURE_TOKEN
  });
  page.click('.btn-copy');

  const request = page.postedMessages[0];
  page.receiveWindowMessage({
    type: 'OAI_EXPORT_RESPONSE',
    conversationId: request.conversationId,
    requestId: request.requestId,
    token: SECURE_TOKEN,
    success: true,
    data: {
      extraction: 'dom',
      conversation_id: TEMPORARY_CONVERSATION_ID,
      title: 'Temporary Chat',
      current_node: 'assistant-node',
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
        },
        'assistant-node': {
          id: 'assistant-node',
          parent: 'user-node',
          message: {
            id: 'assistant-message',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['Hi! How can I help?'] }
          }
        }
      },
      integrity: { status: 'probably-complete', warnings: [] }
    }
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(page.clipboardText, /\*\*ChatGPT:\*\*[\s\S]*Hi! How can I help\?/);
});

test('keeps Gemini temporary UI mounted while its batchexecute ID arrives', () => {
  const page = loadContentScript('/app', {
    hostname: 'gemini.google.com',
    temporaryMode: '临时对话',
    temporaryModeTagName: 'h1'
  });

  page.makeDomReady();
  page.receiveWindowMessage({
    type: 'OAI_CONVERSATION_ID',
    platform: 'gemini',
    conversationId: 'c_77ab2f6b9faa3039',
    token: SECURE_TOKEN
  });

  assert.equal(page.appendCount, 1);
});

test('mounts localized Claude and Perplexity temporary chats', () => {
  const cases = [
    {
      hostname: 'claude.ai',
      pathname: '/new',
      temporaryMode: '隐身聊天'
    },
    {
      hostname: 'www.perplexity.ai',
      pathname: '/',
      temporaryMode: '隐身模式'
    }
  ];

  for (const spec of cases) {
    const page = loadContentScript(spec.pathname, {
      hostname: spec.hostname,
      temporaryMode: spec.temporaryMode,
      temporaryModeTagName: 'h1'
    });
    page.makeDomReady();
    assert.equal(page.appendCount, 1, spec.hostname);
  }
});

test('retries each vendor temporary chat when its DOM conversation ID appears later', () => {
  for (const spec of VENDOR_TEMPORARY_CASES) {
    const page = loadVendorCase(spec, { pathname: spec.domPath, id: null });
    page.makeDomReady();
    assert.equal(page.appendCount, 1, `${spec.hostname} did not show its private-chat control`);
    page.setTemporaryConversationId(spec.id);
    page.poll();
    assert.equal(page.appendCount, 1, `${spec.hostname} did not mount after its ID appeared`);
  }
});

test('does not mount vendor temporary UI without a private-mode signal', () => {
  for (const spec of VENDOR_TEMPORARY_CASES) {
    const page = loadVendorCase(spec, { pathname: spec.domPath, mode: null });
    page.makeDomReady();
    assert.equal(page.appendCount, 0);
  }
});

test('does not treat an inactive vendor temporary-chat button as active mode', () => {
  for (const spec of VENDOR_TEMPORARY_CASES) {
    const page = loadVendorCase(spec, {
      pathname: spec.domPath,
      mode: spec.inactiveMode,
      modeTagName: 'button'
    });
    page.makeDomReady();
    assert.equal(page.appendCount, 0);
  }
});
