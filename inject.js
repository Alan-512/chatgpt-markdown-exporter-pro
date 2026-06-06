(function() {
  const secureToken = document.currentScript ? document.currentScript.dataset.token : null;
  const conversationCache = {};
  let capturedToken = null;

  // Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    let requestUrl = '';
    if (typeof args[0] === 'string') {
      requestUrl = args[0];
    } else if (typeof URL !== 'undefined' && args[0] instanceof URL) {
      requestUrl = args[0].href;
    } else if (args[0] && typeof args[0] === 'object') {
      requestUrl = args[0].url || '';
    }
    const options = args[1] || {};

    // 1. Try to capture Authorization header from outgoing requests
    if (options.headers) {
      let headers = options.headers;
      let token = null;
      if (headers instanceof Headers) {
        if (headers.has('Authorization')) {
          token = headers.get('Authorization');
        }
      } else if (typeof headers === 'object') {
        const authKey = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
        if (authKey) {
          token = headers[authKey];
        }
      }
      if (token && token.startsWith('Bearer ')) {
        capturedToken = token;
      }
    }

    // Call the original fetch
    const response = await originalFetch.apply(this, args);

    // 2. Intercept and cache conversation JSON responses
    const requestMethod = (options.method || 'GET').toUpperCase();
    if (requestMethod === 'GET' && typeof requestUrl === 'string') {
      if (requestUrl.includes('/backend-api/conversation/')) {
        try {
          const cleanUrl = requestUrl.split('?')[0];
          const match = cleanUrl.match(/\/backend-api\/conversation\/([a-f0-9-]+)$/);
          if (match) {
            const conversationId = match[1];
            const clonedResponse = response.clone();
            clonedResponse.json().then(data => {
              if (data && data.mapping && data.current_node) {
                conversationCache[conversationId] = data;
              }
            }).catch(err => {});
          }
        } catch (e) {
          console.error('[Exporter Inject] Error processing ChatGPT fetch:', e);
        }
      } else if (requestUrl.includes('/api/organizations/') && requestUrl.includes('/chat_conversations/')) {
        try {
          const match = requestUrl.match(/\/api\/organizations\/([a-f0-9-]+)\/chat_conversations\/([a-f0-9-]+)/);
          if (match) {
            const orgId = match[1];
            const conversationId = match[2];
            const clonedResponse = response.clone();
            clonedResponse.json().then(data => {
              if (data && data.chat_messages) {
                conversationCache[conversationId] = { source: 'claude', orgId, data };
              }
            }).catch(err => {});
          }
        } catch (e) {
          console.error('[Exporter Inject] Error processing Claude fetch:', e);
        }
      }
    }

    return response;
  };

  // Helper function to fetch the token from the session endpoint
  async function fetchTokenFromSession() {
    try {
      const response = await originalFetch('/api/auth/session');
      if (!response.ok) return null;
      const data = await response.json();
      if (data && data.accessToken) {
        capturedToken = `Bearer ${data.accessToken}`;
        return capturedToken;
      }
    } catch (e) {
      console.error('[Exporter Inject] Failed to fetch token from session:', e);
    }
    return null;
  }

  // Helper function to fetch the ChatGPT conversation data using the token
  async function fetchConversation(conversationId) {
    let token = capturedToken;
    if (!token) {
      token = await fetchTokenFromSession();
    }
    if (!token) {
      throw new Error('Could not retrieve authentication token. Please verify you are logged in to ChatGPT.');
    }

    const response = await originalFetch(`/backend-api/conversation/${conversationId}`, {
      headers: {
        'Authorization': token
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        token = await fetchTokenFromSession();
        if (token) {
          const retryResponse = await originalFetch(`/backend-api/conversation/${conversationId}`, {
            headers: {
              'Authorization': token
            }
          });
          if (retryResponse.ok) {
            const data = await retryResponse.json();
            conversationCache[conversationId] = data;
            return data;
          }
        }
      }
      throw new Error(`Failed to fetch conversation: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    conversationCache[conversationId] = data;
    return data;
  }

  // Helper function to fetch Claude conversation using page cookies/session
  async function fetchClaudeConversation(conversationId) {
    const orgResponse = await originalFetch('/api/organizations');
    if (!orgResponse.ok) {
      throw new Error(`Failed to fetch Claude organizations: ${orgResponse.statusText} (${orgResponse.status})`);
    }
    const orgs = await orgResponse.json();
    if (!orgs || orgs.length === 0) {
      throw new Error('No Claude organization found.');
    }

    let lastError = null;
    for (const org of orgs) {
      if (!org || !org.uuid) continue;
      const orgId = org.uuid;
      try {
        const convResponse = await originalFetch(`/api/organizations/${orgId}/chat_conversations/${conversationId}`);
        if (convResponse.ok) {
          const data = await convResponse.json();
          const result = { source: 'claude', orgId, data };
          conversationCache[conversationId] = result;
          return result;
        } else {
          lastError = new Error(`Failed to fetch Claude conversation: ${convResponse.statusText || 'Unknown'} (${convResponse.status})`);
        }
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('Failed to fetch Claude conversation from any organization.');
  }

  // Gemini specific helper utilities and fetchers
  function getRouteFromUrl() {
    const path = window.location.pathname.replace(/\/+$/, '');
    const segs = path.split('/').filter(Boolean);

    if (segs.length === 0) return null;

    let basePrefix = '';
    let userIndex = null;
    let i = 0;

    if (segs[0] === 'u' && /^\d+$/.test(segs[1] || '')) {
      userIndex = segs[1];
      basePrefix = `/u/${userIndex}`;
      i = 2;
    }

    if (segs[i] === 'app' && segs[i + 1]) {
      const chatId = segs[i + 1];
      return {
        kind: 'app',
        chatId,
        userIndex,
        basePrefix,
        sourcePath: `${basePrefix}/app/${chatId}`
      };
    }

    if (segs[i] === 'gem' && segs[i + 1] && segs[i + 2]) {
      const gemId = segs[i + 1];
      const chatId = segs[i + 2];
      return {
        kind: 'gem',
        gemId,
        chatId,
        userIndex,
        basePrefix,
        sourcePath: `${basePrefix}/gem/${gemId}/${chatId}`
      };
    }

    return null;
  }

  function getAtToken() {
    const input = document.querySelector('input[name="at"]');
    if (input?.value) return input.value;

    const html = document.documentElement.innerHTML;
    let m = html.match(/"SNlM0e":"([^"]+)"/);
    if (m) return m[1];
    try {
      if (window.WIZ_global_data?.SNlM0e) return window.WIZ_global_data.SNlM0e;
    } catch {}
    return null;
  }

  function parseBatchExecute(text, targetRpcId = 'hNvQHb') {
    if (text.startsWith(")]}'\n")) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const payloads = [];

    for (let i = 0; i < lines.length; ) {
      const lenStr = lines[i++];
      const len = parseInt(lenStr, 10);
      if (!isFinite(len)) break;
      const jsonLine = lines[i++] || '';
      let segment;
      try {
        segment = JSON.parse(jsonLine);
      } catch {
        continue;
      }
      if (Array.isArray(segment)) {
        for (const entry of segment) {
          if (Array.isArray(entry) && entry[0] === 'wrb.fr' && entry[1] === targetRpcId) {
            const s = entry[2];
            if (typeof s === 'string') {
              try {
                const inner = JSON.parse(s);
                payloads.push(inner);
              } catch {}
            }
          }
        }
      }
    }
    return payloads;
  }

  async function fetchGeminiTitle(route, at) {
    const fullChatId = route.chatId.startsWith('c_') ? route.chatId : `c_${route.chatId}`;
    const tryArgsList = [
      JSON.stringify([13, null, [0, null, 1]]),
      JSON.stringify([200, null, [0, null, 1]]),
      null
    ];

    const prefix = route.basePrefix || '';
    const batchUrl = `${prefix}/_/BardChatUi/data/batchexecute`;

    for (const innerArgs of tryArgsList) {
      try {
        const fReq = [[["MaZiqc", innerArgs, null, "generic"]]];
        const params = new URLSearchParams({
          rpcids: 'MaZiqc',
          'source-path': route.sourcePath,
          hl: document.documentElement.lang || 'en',
          rt: 'c'
        });
        const body = new URLSearchParams({ 'f.req': JSON.stringify(fReq), at });

        const res = await originalFetch(`${batchUrl}?${params.toString()}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-same-domain': '1',
            'accept': '*/*'
          },
          body: body.toString() + '&'
        });

        if (!res.ok) continue;

        const text = await res.text();
        const payloads = parseBatchExecute(text, 'MaZiqc');

        for (const payload of payloads) {
          const title = findTitleInPayload(payload, fullChatId);
          if (title) return title;
        }
      } catch (e) {}
    }
    return null;
  }

  function findTitleInPayload(root, fullChatId) {
    let found = null;
    (function walk(node) {
      if (found) return;
      if (Array.isArray(node)) {
        if (node.length >= 2 &&
            typeof node[0] === 'string' &&
            node[0] === fullChatId &&
            typeof node[1] === 'string' &&
            node[1].trim()) {
          found = node[1].trim();
          return;
        }
        for (const child of node) walk(child);
      }
    })(root);
    return found;
  }

  function isUserMessageNode(node) {
    return (
      Array.isArray(node) &&
      node.length >= 2 &&
      Array.isArray(node[0]) &&
      node[0].length >= 1 &&
      node[0].every(p => typeof p === 'string') &&
      (node[1] === 2 || node[1] === 1)
    );
  }

  function getUserTextFromNode(userNode) {
    try {
      return userNode[0].join('\n');
    } catch {
      return '';
    }
  }

  function isAssistantNode(node) {
    return (
      Array.isArray(node) &&
      node.length >= 2 &&
      typeof node[0] === 'string' &&
      node[0].startsWith('rc_') &&
      Array.isArray(node[1]) &&
      typeof node[1][0] === 'string'
    );
  }

  function isAssistantContainer(node) {
    return (
      Array.isArray(node) &&
      node.length >= 1 &&
      Array.isArray(node[0]) &&
      node[0].length >= 1 &&
      isAssistantNode(node[0][0])
    );
  }

  function getAssistantNodeFromContainer(container) {
    try {
      return container[0][0];
    } catch {
      return null;
    }
  }

  function getAssistantTextFromNode(assistantNode) {
    try {
      return assistantNode[1][0] || '';
    } catch {
      return '';
    }
  }

  function extractReasoningFromAssistantNode(assistantNode) {
    if (!Array.isArray(assistantNode)) return null;
    for (let k = assistantNode.length - 1; k >= 0; k--) {
      const child = assistantNode[k];
      if (Array.isArray(child)) {
        if (
          child.length >= 2 &&
          Array.isArray(child[1]) &&
          child[1].length >= 1 &&
          Array.isArray(child[1][0]) &&
          child[1][0].length >= 1 &&
          child[1][0].every(x => typeof x === 'string')
        ) {
          const txt = child[1][0].join('\n\n').trim();
          if (txt) return txt;
        }
        if (
          Array.isArray(child[0]) &&
          child[0].length >= 1 &&
          child[0].every(x => typeof x === 'string')
        ) {
          const txt = child[0].join('\n\n').trim();
          if (txt) return txt;
        }
      }
    }
    return null;
  }

  function isTimestampPair(arr) {
    return Array.isArray(arr) && arr.length === 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number' && arr[0] > 1_600_000_000;
  }

  function cmpTimestampAsc(a, b) {
    if (!a.tsPair && !b.tsPair) return 0;
    if (!a.tsPair) return -1;
    if (!b.tsPair) return 1;
    if (a.tsPair[0] !== b.tsPair[0]) return a.tsPair[0] - b.tsPair[0];
    return a.tsPair[1] - b.tsPair[1];
  }

  function detectBlock(node) {
    if (!Array.isArray(node)) return null;
    let userNode = null;
    let assistantContainer = null;
    let tsCandidate = null;

    for (const child of node) {
      if (isUserMessageNode(child) && !userNode) userNode = child;
      if (isAssistantContainer(child) && !assistantContainer) assistantContainer = child;
      if (isTimestampPair(child)) {
        if (!tsCandidate || child[0] > tsCandidate[0] || (child[0] === tsCandidate[0] && child[1] > tsCandidate[1])) {
          tsCandidate = child;
        }
      }
    }
    if (userNode && assistantContainer) {
      const assistantNode = getAssistantNodeFromContainer(assistantContainer);
      if (!assistantNode) return null;
      const userText = getUserTextFromNode(userNode);
      const assistantText = getAssistantTextFromNode(assistantNode);
      const thoughtsText = extractReasoningFromAssistantNode(assistantNode);
      return {
        userText,
        assistantText,
        thoughtsText: thoughtsText || null,
        tsPair: tsCandidate || null
      };
    }
    return null;
  }

  function extractBlocksFromPayloadRoot(root) {
    const blocks = [];
    const seenComposite = new Set();

    function scan(node) {
      if (!Array.isArray(node)) return;
      const block = detectBlock(node);
      if (block) {
        const key = JSON.stringify([
          block.userText,
          block.assistantText,
          block.thoughtsText || '',
          block.tsPair?.[0] || 0,
          block.tsPair?.[1] || 0
        ]);
        if (!seenComposite.has(key)) {
          seenComposite.add(key);
          blocks.push(block);
        }
      }
      for (const child of node) scan(child);
    }
    scan(root);
    return blocks;
  }

  function extractAllBlocks(payloads) {
    let blocks = [];
    for (const p of payloads) {
      const b = extractBlocksFromPayloadRoot(p);
      blocks = blocks.concat(b);
    }
    const withIndex = blocks.map((b, i) => ({ ...b, _i: i }));
    withIndex.sort((a, b) => {
      const c = cmpTimestampAsc(a, b);
      return c !== 0 ? c : a._i - b._i;
    });
    return withIndex.map(({ _i, ...rest }) => rest);
  }

  async function fetchGeminiConversation(chatId) {
    const route = getRouteFromUrl();
    if (!route) {
      throw new Error('Could not resolve Gemini route. Are you on a conversation page?');
    }
    const at = getAtToken();
    if (!at) {
      throw new Error('Could not find anti-CSRF token "at" on the page.');
    }

    const convKey = chatId.startsWith('c_') ? chatId : `c_${chatId}`;
    const innerArgs = JSON.stringify([convKey, 1000, null, 1, [1], [4], null, 1]);
    const fReq = [[["hNvQHb", innerArgs, null, "generic"]]];

    const prefix = route.basePrefix || '';
    const batchUrl = `${prefix}/_/BardChatUi/data/batchexecute`;

    const params = new URLSearchParams({
      rpcids: 'hNvQHb',
      'source-path': route.sourcePath,
      hl: document.documentElement.lang || 'en',
      rt: 'c'
    });
    const body = new URLSearchParams({ 'f.req': JSON.stringify(fReq), at });

    const res = await originalFetch(`${batchUrl}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-same-domain': '1',
        'accept': '*/*'
      },
      body: body.toString() + '&'
    });

    if (!res.ok) {
      throw new Error(`batchexecute failed: ${res.status} ${res.statusText}`);
    }
    const rawText = await res.text();
    const payloads = parseBatchExecute(rawText, 'hNvQHb');
    if (!payloads.length) {
      throw new Error('No conversation payloads found in Gemini batchexecute response.');
    }

    const blocks = extractAllBlocks(payloads);
    if (!blocks.length) {
      throw new Error('Could not extract any User/Assistant messages from Gemini payload.');
    }

    let title = null;
    try {
      title = await fetchGeminiTitle(route, at);
    } catch (e) {}

    const conversationData = {
      source: 'gemini',
      chatId: chatId,
      title: title || document.title.replace(' - Gemini', '').replace('Gemini', 'Gemini Chat').trim(),
      blocks: blocks
    };

    conversationCache[chatId] = conversationData;
    return conversationData;
  }

  // Listen for messages from content.js with strict origin validation
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    
    const message = event.data;
    if (message && message.type === 'OAI_EXPORT_REQUEST') {
      // Security Check: Verify shared token to prevent eavesdropping and spoofing
      if (!secureToken || message.token !== secureToken) return;

      const { conversationId, platform, requestId } = message;

      // Security Check: Verify conversationId format to prevent path traversal
      const idPattern = platform === 'gemini' ? /^[a-zA-Z0-9_:-]+$/ : /^[a-f0-9-]+$/;
      if (typeof conversationId !== 'string' || !idPattern.test(conversationId)) {
        window.postMessage({
          type: 'OAI_EXPORT_RESPONSE',
          conversationId,
          requestId,
          token: secureToken,
          success: false,
          error: 'Invalid Conversation ID format.'
        }, window.location.origin);
        return;
      }

      try {
        let data = conversationCache[conversationId];
        
        // If data is missing, bypass cache and fetch fresh
        if (!data) {
          if (platform === 'claude') {
            data = await fetchClaudeConversation(conversationId);
          } else if (platform === 'gemini') {
            data = await fetchGeminiConversation(conversationId);
          } else {
            data = await fetchConversation(conversationId);
          }
        } else {
          // If we have cached data but it's ChatGPT and incomplete, refresh
          if (!platform || platform === 'chatgpt') {
            if (!data.mapping || !data.current_node) {
              data = await fetchConversation(conversationId);
            }
          }
        }

        window.postMessage({
          type: 'OAI_EXPORT_RESPONSE',
          conversationId,
          requestId,
          token: secureToken,
          success: true,
          data
        }, window.location.origin);
      } catch (err) {
        window.postMessage({
          type: 'OAI_EXPORT_RESPONSE',
          conversationId,
          requestId,
          token: secureToken,
          success: false,
          error: err.message
        }, window.location.origin);
      }
    }
  });

  console.log('[Exporter Inject] Successfully initialized secure window.fetch hooks.');
})();

