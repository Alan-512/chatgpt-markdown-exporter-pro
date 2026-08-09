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

function createNode() {
  return {
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() { return true; }
    },
    addEventListener() {},
    contains() { return false; },
    querySelector() { return createNode(); },
    remove() {}
  };
}

function loadContentScript(pathname) {
  const documentListeners = new Map();
  const intervalCallbacks = [];
  let mountedContainer = null;
  let appendCount = 0;

  const location = {
    href: `https://chatgpt.com${pathname}`,
    pathname,
    hostname: 'chatgpt.com',
    origin: 'https://chatgpt.com'
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
    addEventListener(type, callback, options = {}) {
      const listeners = documentListeners.get(type) || [];
      listeners.push({ callback, once: options.once === true });
      documentListeners.set(type, listeners);
    }
  };

  const window = {
    location,
    addEventListener() {},
    postMessage() {}
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
        writeText: async () => {}
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
      location.pathname = nextPathname;
      location.href = `https://chatgpt.com${nextPathname}`;
      for (const callback of intervalCallbacks) callback();
    },
    get appendCount() {
      return appendCount;
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

test('does not mount the export UI on a non-conversation page', () => {
  const page = loadContentScript('/');

  page.makeDomReady();

  assert.equal(page.appendCount, 0);
});
