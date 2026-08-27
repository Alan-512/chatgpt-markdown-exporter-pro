(function() {
  const secureToken = document.currentScript ? document.currentScript.dataset.token : null;
  const conversationCache = {};
  const PERPLEXITY_LAST_CACHE_KEY = '__perplexity_last_conversation__';
  const CHATGPT_CONVERSATION_ID_PATTERN = /(?:["'](?:conversation_id|conversationId)["']\s*:\s*["']|(?:^|[?&\s])(?:conversation_id|conversationId)=)([a-f0-9-]+)/gi;
  const CHATGPT_CONVERSATION_URL_PATTERN = /\/backend-api\/(?:[^\/?#]+\/)*conversation(?:[\/?#]|$)/i;
  const CHATGPT_CONVERSATION_ROUTE_PATTERN = /\/backend-api\/(?:[^\/?#]+\/)*conversation\/([a-f0-9-]+)(?:[\/?#]|$)/i;
  const CLAUDE_CONVERSATION_URL_PATTERN = /\/api\/organizations\/[^\/?#]+\/chat_conversations\/([a-f0-9-]+)(?:[\/?#]|$)/i;
  const PERPLEXITY_THREAD_URL_PATTERN = /\/(?:search|page)\/([a-zA-Z0-9_%:.~=-]+)(?:[\/?#]|$)/i;
  const PERPLEXITY_RELEVANT_URL_PATTERN = /\/api\/|graphql|thread|conversation|query|search|answer/i;
  const PERPLEXITY_CONVERSATION_ID_PATTERN = /["'](?:threadId|thread_id|conversationId|conversation_id)["']\s*:\s*["']([a-zA-Z0-9_%:.~=-]+)["']/gi;
  const GEMINI_BATCH_URL_PATTERN = /\/_\/BardChatUi\/data\/batchexecute(?:[?/#]|$)/i;
  const GEMINI_STREAM_URL_PATTERN = /\/_\/BardChatUi\/data\/assistant\.lamda\.BardFrontendService\/StreamGenerate(?:[?/#]|$)/i;
  const GEMINI_CONVERSATION_URL_PATTERN = new RegExp(
    `(?:${GEMINI_BATCH_URL_PATTERN.source}|${GEMINI_STREAM_URL_PATTERN.source})`,
    'i'
  );
  const GEMINI_CONVERSATION_ID_PATTERN = /\bc_[a-zA-Z0-9_-]{8,}\b/g;
  const GEMINI_DOM_FALLBACK_ID = '__gemini_temp_dom__';
  const emittedConversationIds = new Set();
  let capturedToken = null;

  function emitConversationId(conversationId, platform = 'chatgpt') {
    const idPattern = platform === 'gemini'
      ? /^c_[a-zA-Z0-9_-]{8,}$/
      : platform === 'perplexity'
        ? /^[a-zA-Z0-9_%:.~=-]+$/
        : /^[a-f0-9-]+$/i;
    if (typeof conversationId !== 'string' || !idPattern.test(conversationId)) return;

    const cacheKey = `${platform}:${conversationId}`;
    if (emittedConversationIds.has(cacheKey)) return;
    emittedConversationIds.add(cacheKey);

    window.postMessage({
      type: 'OAI_CONVERSATION_ID',
      conversationId,
      platform,
      token: secureToken
    }, window.location.origin);
  }

  function emitConversationIds(text) {
    if (typeof text !== 'string') return;

    const normalizedText = text.replace(/\\"/g, '"');
    const conversationIds = new Set();
    let match;
    while ((match = CHATGPT_CONVERSATION_ID_PATTERN.exec(normalizedText))) {
      conversationIds.add(match[1]);
    }
    CHATGPT_CONVERSATION_ID_PATTERN.lastIndex = 0;

    for (const conversationId of conversationIds) {
      emitConversationId(conversationId);
    }
  }

  function observeChatGPTConversationResponse(requestUrl, requestMethod, response) {
    if (!CHATGPT_CONVERSATION_URL_PATTERN.test(requestUrl)) {
      return;
    }

    try {
      response.clone().text().then(emitConversationIds).catch(() => {});
    } catch (e) {
      // Some response types cannot be cloned; the page request must still complete.
    }
  }

  function observeChatGPTConversationRequest(requestUrl, requestMethod, body) {
    if (
      requestMethod === 'GET' ||
      typeof body !== 'string' ||
      !/\/backend-api\//i.test(requestUrl)
    ) {
      return;
    }

    emitConversationIds(body);
  }

  function emitClaudeConversationIdFromUrl(requestUrl) {
    const match = typeof requestUrl === 'string' && requestUrl.match(CLAUDE_CONVERSATION_URL_PATTERN);
    if (match) emitConversationId(match[1], 'claude');
  }

  function emitPerplexityConversationIdFromUrl(requestUrl) {
    const match = typeof requestUrl === 'string' && requestUrl.match(PERPLEXITY_THREAD_URL_PATTERN);
    if (match) emitConversationId(match[1], 'perplexity');
  }

  function emitPerplexityConversationIds(text) {
    if (typeof text !== 'string') return;

    const normalizedText = text.replace(/\\"/g, '"');
    const conversationIds = new Set();
    let match;
    while ((match = PERPLEXITY_CONVERSATION_ID_PATTERN.exec(normalizedText))) {
      conversationIds.add(match[1]);
    }
    PERPLEXITY_CONVERSATION_ID_PATTERN.lastIndex = 0;

    for (const conversationId of conversationIds) {
      emitConversationId(conversationId, 'perplexity');
    }
  }

  function observePerplexityConversationRequest(requestUrl, requestMethod, body) {
    emitPerplexityConversationIdFromUrl(requestUrl);
    if (requestMethod !== 'GET' && typeof body === 'string') {
      emitPerplexityConversationIds(body);
    }
  }

  function observePerplexityConversationResponse(requestUrl, response) {
    emitPerplexityConversationIdFromUrl(requestUrl);
    if (!response) return;

    try {
      response.clone().text().then(emitPerplexityConversationIds).catch(() => {});
    } catch (e) {
      // Some response types cannot be cloned; the page request must still complete.
    }
  }

  function emitGeminiConversationIds(text) {
    if (typeof text !== 'string') return;

    const normalizedText = text.replace(/\\"/g, '"');
    const conversationIds = new Set();
    let match;
    while ((match = GEMINI_CONVERSATION_ID_PATTERN.exec(normalizedText))) {
      conversationIds.add(match[0]);
    }
    GEMINI_CONVERSATION_ID_PATTERN.lastIndex = 0;

    for (const conversationId of conversationIds) {
      emitConversationId(conversationId, 'gemini');
    }
  }

  function observeGeminiConversationResponse(requestUrl, response) {
    if (!GEMINI_CONVERSATION_URL_PATTERN.test(requestUrl) || isGeminiChatListRequest(requestUrl)) return;

    try {
      response.clone().text().then(emitGeminiConversationIds).catch(() => {});
    } catch (e) {
      // Some response types cannot be cloned; the page request must still complete.
    }
  }

  function observeGeminiConversationRequest(requestUrl, requestMethod, body) {
    if (
      requestMethod === 'GET' ||
      typeof body !== 'string' ||
      !GEMINI_CONVERSATION_URL_PATTERN.test(requestUrl) ||
      isGeminiChatListRequest(requestUrl)
    ) {
      return;
    }

    emitGeminiConversationIds(body);
  }

  function isGeminiChatListRequest(requestUrl) {
    try {
      const url = new URL(requestUrl, window.location.origin);
      const rpcIds = (url.searchParams.get('rpcids') || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
      return rpcIds.length === 1 && rpcIds[0] === 'MaZiqc';
    } catch (e) {
      return false;
    }
  }

  // Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    let requestUrl = '';
    const request = args[0] && typeof args[0] === 'object' ? args[0] : null;
    if (typeof args[0] === 'string') {
      requestUrl = args[0];
    } else if (typeof URL !== 'undefined' && args[0] instanceof URL) {
      requestUrl = args[0].href;
    } else if (args[0] && typeof args[0] === 'object') {
      requestUrl = args[0].url || '';
    }
    const options = args[1] || {};
    const requestMethod = (options.method || request?.method || 'GET').toUpperCase();
    const requestHeaders = options.headers || request?.headers;
    const isBackendRequest = typeof requestUrl === 'string' && /\/backend-api\//i.test(requestUrl);
    const isClaudeRequest = typeof requestUrl === 'string' && CLAUDE_CONVERSATION_URL_PATTERN.test(requestUrl);
    const isGeminiRequest = typeof requestUrl === 'string' && GEMINI_CONVERSATION_URL_PATTERN.test(requestUrl);
    const isPerplexityRequest = isPerplexityHost() &&
      typeof requestUrl === 'string' &&
      PERPLEXITY_RELEVANT_URL_PATTERN.test(requestUrl);

    if (isBackendRequest) {
      observeChatGPTConversationRequest(requestUrl, requestMethod, options.body);
    }
    if (isClaudeRequest) emitClaudeConversationIdFromUrl(requestUrl);
    if (isGeminiRequest) observeGeminiConversationRequest(requestUrl, requestMethod, options.body);
    if (isPerplexityRequest) observePerplexityConversationRequest(requestUrl, requestMethod, options.body);
    if (
      request &&
      typeof request.clone === 'function' &&
      typeof requestUrl === 'string' &&
      requestMethod !== 'GET' &&
      (isBackendRequest || isClaudeRequest || isGeminiRequest || isPerplexityRequest)
    ) {
      try {
        request.clone().text().then(body => {
          if (isBackendRequest) observeChatGPTConversationRequest(requestUrl, requestMethod, body);
          if (isClaudeRequest) emitClaudeConversationIdFromUrl(requestUrl);
          if (isGeminiRequest) observeGeminiConversationRequest(requestUrl, requestMethod, body);
          if (isPerplexityRequest) observePerplexityConversationRequest(requestUrl, requestMethod, body);
        })
          .catch(() => {});
      } catch (e) {
        // Some Request bodies cannot be cloned; the page request must still complete.
      }
    }

    // 1. Try to capture Authorization header from outgoing requests
    if (requestHeaders) {
      let headers = requestHeaders;
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
    if (typeof requestUrl === 'string') {
      observeChatGPTConversationResponse(requestUrl, requestMethod, response);
      if (isClaudeRequest) emitClaudeConversationIdFromUrl(requestUrl);
      observeGeminiConversationResponse(requestUrl, response);
      if (isPerplexityRequest) observePerplexityConversationResponse(requestUrl, response);
    }
    if (requestMethod === 'GET' && typeof requestUrl === 'string') {
      if (CHATGPT_CONVERSATION_ROUTE_PATTERN.test(requestUrl)) {
        try {
          const match = requestUrl.match(CHATGPT_CONVERSATION_ROUTE_PATTERN);
          if (match) {
            const conversationId = match[1];
            emitConversationId(conversationId);
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
            emitConversationId(conversationId, 'claude');
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

    // 3. Perplexity changes its private endpoints frequently, so cache any plausible
    // thread payload observed through the page's own authenticated fetches.
    if (typeof requestUrl === 'string' && isPerplexityHost()) {
      maybeCachePerplexityResponse(requestUrl, response);
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

  function isChatGPTTemporaryPage() {
    try {
      const value = new URL(window.location.href).searchParams.get('temporary-chat');
      return value === '' || /^true$/i.test(value);
    } catch (e) {
      return false;
    }
  }

  function hasChatGPTMessageContent(message) {
    const parts = message?.content?.parts;
    return (
      (Array.isArray(parts) && parts.some(part => (
        typeof part === 'string' ? part.trim().length > 0 : part != null
      ))) ||
      Boolean(message?.metadata?.command)
    );
  }

  function hasChatGPTAssistantMessage(data) {
    if (!data || !data.mapping || !data.current_node) return false;

    const visited = new Set();
    let lastMeaningfulMessage = null;
    let nodeId = data.current_node;
    while (nodeId && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = data.mapping[nodeId];
      const message = node?.message;
      if (message && message.author?.role && message.author.role !== 'system') {
        lastMeaningfulMessage = message;
      }
      nodeId = node?.parent || null;
    }

    return lastMeaningfulMessage?.author?.role === 'assistant' &&
      hasChatGPTMessageContent(lastMeaningfulMessage);
  }

  function getChatGPTDomText(node) {
    let source = node;
    try {
      const clone = typeof node?.cloneNode === 'function' ? node.cloneNode(true) : null;
      if (clone && typeof clone.querySelectorAll === 'function') {
        for (const noisy of clone.querySelectorAll(
          'button, svg, img, [aria-hidden="true"], [class*="sr-only" i], [class*="screen-reader" i], [aria-label*="copy" i], [aria-label*="regenerate" i], [data-testid*="copy" i], [data-testid*="regenerate" i]'
        )) {
          noisy.remove?.();
        }
        source = clone;
      }
    } catch (e) {}

    return String(source?.innerText || source?.textContent || '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  function extractChatGPTTemporaryDomConversation(conversationId) {
    const selectors = [
      'main [data-message-author-role="user"]',
      'main [data-message-author-role="assistant"]',
      '[data-message-author-role="user"]',
      '[data-message-author-role="assistant"]'
    ];
    const candidates = [];
    const seen = new Set();

    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (e) {}

      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        const role = node.getAttribute?.('data-message-author-role');
        const text = getChatGPTDomText(node);
        if (!['user', 'assistant'].includes(role) || !text) continue;
        if (candidates.some(candidate => candidate.node.contains?.(node))) continue;
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (node.contains?.(candidates[i].node)) candidates.splice(i, 1);
        }
        seen.add(node);
        candidates.push({ node, role, text });
      }
    }

    candidates.sort((a, b) => {
      if (typeof a.node.compareDocumentPosition !== 'function') return 0;
      const position = a.node.compareDocumentPosition(b.node);
      if (position & 4) return -1;
      if (position & 2) return 1;
      return 0;
    });

    if (!candidates.some(candidate => candidate.role === 'assistant')) {
      throw new Error('Could not extract the ChatGPT assistant reply from the current page. Wait for the reply to finish, then try again.');
    }

    const mapping = {};
    let parent = null;
    let currentNode = null;
    candidates.forEach((candidate, index) => {
      const nodeId = `dom-${index}`;
      mapping[nodeId] = {
        id: nodeId,
        parent,
        message: {
          id: nodeId,
          author: { role: candidate.role },
          content: { content_type: 'text', parts: [candidate.text] },
          metadata: {}
        }
      };
      parent = nodeId;
      currentNode = nodeId;
    });

    const title = String(document.title || '')
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, '')
      .trim() || 'ChatGPT Temporary Chat';
    return {
      conversation_id: conversationId,
      title,
      mapping,
      current_node: currentNode,
      extraction: 'dom',
      integrity: {
        status: 'probably-complete',
        warnings: ['ChatGPT returned an incomplete temporary-chat record; export used the current page messages. Scroll through the full chat first if older turns are virtualized.']
      }
    };
  }

  async function recoverChatGPTTemporaryConversation(data, conversationId) {
    if (!isChatGPTTemporaryPage() || hasChatGPTAssistantMessage(data)) return data;

    try {
      const freshData = await fetchConversation(conversationId);
      if (hasChatGPTAssistantMessage(freshData)) return freshData;
      data = freshData;
    } catch (e) {}

    return extractChatGPTTemporaryDomConversation(conversationId);
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

    if (segs.length === 0) {
      return {
        kind: 'app',
        chatId: null,
        userIndex: null,
        basePrefix: '',
        sourcePath: '/app'
      };
    }

    let basePrefix = '';
    let userIndex = null;
    let i = 0;

    if (segs[0] === 'u' && /^\d+$/.test(segs[1] || '')) {
      userIndex = segs[1];
      basePrefix = `/u/${userIndex}`;
      i = 2;
    }

    if (segs.length === i) {
      return {
        kind: 'app',
        chatId: null,
        userIndex,
        basePrefix,
        sourcePath: `${basePrefix}/app`
      };
    }

    if (segs[i] === 'app') {
      const chatId = segs[i + 1] || null;
      return {
        kind: 'app',
        chatId,
        userIndex,
        basePrefix,
        sourcePath: chatId ? `${basePrefix}/app/${chatId}` : `${basePrefix}/app`
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

  function cleanGeminiDomText(value) {
    return typeof value === 'string'
      ? value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim()
      : '';
  }

  function getGeminiDomAttribute(node, name) {
    try {
      return node && typeof node.getAttribute === 'function'
        ? (node.getAttribute(name) || '')
        : '';
    } catch (e) {
      return '';
    }
  }

  function inferGeminiDomRole(node) {
    const tagName = typeof node?.tagName === 'string' ? node.tagName.toLowerCase() : '';
    const role = getGeminiDomAttribute(node, 'data-message-author-role') ||
      getGeminiDomAttribute(node, 'role');
    if (/^(?:user|human)$/i.test(role)) return 'user';
    if (/^(?:assistant|model)$/i.test(role)) return 'assistant';

    const descriptor = [
      tagName,
      getGeminiDomAttribute(node, 'data-testid'),
      getGeminiDomAttribute(node, 'aria-label'),
      typeof node?.className === 'string' ? node.className : ''
    ].join(' ').toLowerCase();
    if (/user-query|\buser\b|\bhuman\b|\bquery\b/.test(descriptor)) return 'user';
    if (/model-response|\bassistant\b|\bmodel\b|\bresponse\b/.test(descriptor)) return 'assistant';
    return null;
  }

  function getGeminiDomText(node) {
    let source = node;
    try {
      const clone = typeof node?.cloneNode === 'function' ? node.cloneNode(true) : null;
      if (clone && typeof clone.querySelectorAll === 'function') {
        for (const noisy of clone.querySelectorAll(
          'button, svg, img, mat-icon, tool-bar, [aria-label*="copy" i], [aria-label*="regenerate" i]'
        )) {
          noisy.remove?.();
        }
        source = clone;
      }
    } catch (e) {}

    return cleanGeminiDomText(source?.innerText || source?.textContent || '');
  }

  function collectGeminiDomMessages() {
    const selectors = [
      'main user-query',
      'user-query',
      'main model-response',
      'model-response',
      'main message-content',
      'message-content',
      'main [data-message-author-role="user"]',
      'main [data-message-author-role="assistant"]',
      'main [data-testid*="user-message" i]',
      'main [data-testid*="model-response" i]',
      'main [data-testid*="assistant-message" i]',
      'main [data-testid*="response" i]'
    ];
    const candidates = [];
    const seen = new Set();

    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (e) {}

      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        const role = inferGeminiDomRole(node);
        const text = getGeminiDomText(node);
        if (!role || !text) continue;

        if (candidates.some(candidate => candidate.node.contains?.(node))) continue;
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (node.contains?.(candidates[i].node)) candidates.splice(i, 1);
        }
        seen.add(node);
        candidates.push({ node, role, text });
      }
    }

    candidates.sort((a, b) => {
      if (typeof a.node.compareDocumentPosition !== 'function') return 0;
      const position = a.node.compareDocumentPosition(b.node);
      if (position & 4) return -1;
      if (position & 2) return 1;
      return 0;
    });
    return candidates;
  }

  function extractGeminiDomConversation() {
    const messages = collectGeminiDomMessages();
    const blocks = [];
    let pendingUser = null;

    for (const message of messages) {
      if (message.role === 'user') {
        pendingUser = message.text;
      } else if (message.role === 'assistant' && pendingUser) {
        blocks.push({
          userText: pendingUser,
          assistantText: message.text,
          thoughtsText: null,
          tsPair: null
        });
        pendingUser = null;
      }
    }

    if (pendingUser && blocks.length === 0) {
      blocks.push({
        userText: pendingUser,
        assistantText: '',
        thoughtsText: null,
        tsPair: null
      });
    }
    if (!blocks.length) {
      throw new Error('Could not extract Gemini messages from the current page.');
    }

    const title = cleanGeminiDomText(document.title || '').replace(/\s*-\s*Gemini\s*$/i, '') ||
      'Gemini Temporary Chat';
    return {
      source: 'gemini',
      extraction: 'dom',
      title,
      blocks,
      integrity: {
        status: 'probably-complete',
        warnings: ['Gemini conversation ID was unavailable; export used the current page messages. Scroll through the full chat before exporting if the thread is virtualized.']
      }
    };
  }

  async function fetchGeminiConversation(chatId) {
    if (chatId === GEMINI_DOM_FALLBACK_ID) {
      return extractGeminiDomConversation();
    }

    const route = getRouteFromUrl();
    if (!route) {
      throw new Error('Could not resolve Gemini route. Are you on a conversation page?');
    }
    // Temporary Gemini chats stay on /app while their c_... ID only exists in
    // the batchexecute payload. Attach the captured ID so title lookup uses
    // the same conversation as the read request below.
    route.chatId = chatId;
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

    if (!payloads.some(payload => JSON.stringify(payload).includes(convKey))) {
      throw new Error('Gemini returned a different conversation than the active chat.');
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

  // Perplexity helpers. The site has changed private APIs multiple times, so this
  // exporter uses layered extraction: cached internal JSON first, hydration data
  // second, and visible thread DOM as a final fallback.
  function isPerplexityHost() {
    return /(^|\.)perplexity\.ai$/i.test(window.location.hostname);
  }

  function getPerplexityRouteId() {
    const segs = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (segs.length === 0) return null;
    const threadRouteIndex = segs.findIndex(seg => seg === 'search' || seg === 'page');
    if (threadRouteIndex >= 0 && segs[threadRouteIndex + 1]) return segs[threadRouteIndex + 1];
    return segs[segs.length - 1] || null;
  }

  function cleanPerplexityText(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cleanPerplexityMarkdown(text) {
    if (typeof text !== 'string') return '';
    const collapsed = text
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*(- )/g, '\n$1')
      .replace(/\n{2,}\s*(\d+\. )/g, '\n$1')
      .replace(/([。！？!?；;：:，,.])\s*\n+\s*\(\[/g, '$1([')
      .replace(/([。！？!?；;：:，,.])\s*\n+\s*（\[/g, '$1（[')
      .replace(/([^\n])\n+\s*\(\[/g, '$1([')
      .replace(/([^\n])\n+\s*（\[/g, '$1（[')
      .replace(/([\u4e00-\u9fff])\s+\(\[/g, '$1([')
      .replace(/([\u4e00-\u9fff。！？!?；;：:，,.])\s+\(\[/g, '$1([')
      .replace(/\s+\(\[/g, ' ([')
      .replace(/\s+（\[/g, '（[')
      .replace(/\n{2,}\s*\(/g, '(')
      .replace(/\n{2,}\s*（/g, '（')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}\s*\n/g, '\n\n')
      .trim();
    return collapsed
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')
      .replace(/([。！？!?；;：:，,.])\s*\n+\s*\(\[/g, '$1([')
      .replace(/([。！？!?；;：:，,.])\s*\n+\s*（\[/g, '$1（[')
      .replace(/([^\n])\n+\s*\(\[/g, '$1([')
      .replace(/([^\n])\n+\s*（\[/g, '$1（[')
      .replace(/([\u4e00-\u9fff。！？!?；;：:，,.])\s+\(\[/g, '$1([');
  }

  function toAbsolutePerplexityUrl(href) {
    if (!href || typeof href !== 'string') return '';
    const trimmed = href.trim();
    if (!trimmed || trimmed === '#' || /^javascript:/i.test(trimmed)) return '';
    try {
      return new URL(trimmed, window.location.href).href;
    } catch {
      return '';
    }
  }

  function escapeMarkdownLabel(label) {
    return cleanPerplexityText(label)
      .replace(/\s+/g, ' ')
      .replace(/[\[\]]/g, '')
      .trim();
  }

  function addPerplexitySourceMapEntry(map, label, url) {
    const cleanLabel = escapeMarkdownLabel(label);
    const absoluteUrl = toAbsolutePerplexityUrl(url);
    if (!cleanLabel || !absoluteUrl) return;

    const variants = new Set([
      cleanLabel,
      cleanLabel.replace(/\s*\+\d+\s*$/, '').trim()
    ]);

    try {
      const parsed = new URL(absoluteUrl);
      const host = parsed.hostname.replace(/^www\./i, '');
      variants.add(host);
      variants.add(host.split('.')[0]);
    } catch {}

    const domainLike = cleanLabel.match(/[a-z0-9][a-z0-9.-]+\.[a-z]{2,}/i);
    if (domainLike) {
      const domain = domainLike[0].replace(/^www\./i, '');
      variants.add(domain);
      variants.add(domain.split('.')[0]);
    }

    for (const variant of variants) {
      if (variant) map.set(variant.toLowerCase(), absoluteUrl);
    }
  }

  function collectPerplexitySourceLinkMap() {
    const map = new Map();
    for (const anchor of document.querySelectorAll('a[href]')) {
      const url = toAbsolutePerplexityUrl(anchor.getAttribute('href'));
      if (!url) continue;
      const label = cleanPerplexityText(anchor.innerText || anchor.textContent || '');
      addPerplexitySourceMapEntry(map, label, url);
      addPerplexitySourceMapEntry(map, anchor.getAttribute('aria-label') || '', url);
      addPerplexitySourceMapEntry(map, anchor.getAttribute('title') || '', url);
    }
    return map;
  }

  function isPerplexityCitationLikeLabel(label) {
    const text = cleanPerplexityText(label).replace(/\s+/g, ' ');
    if (!text || text.length > 80) return false;
    if (/\+\d+\s*$/.test(text)) return true;
    if (/^[a-z0-9][a-z0-9.-]{2,}$/i.test(text)) return true;
    return false;
  }

  function getPerplexityElementAttrs(el) {
    return [
      el.getAttribute('data-testid'),
      el.getAttribute('aria-label'),
      el.getAttribute('role'),
      el.getAttribute('title'),
      typeof el.className === 'string' ? el.className : '',
      el.tagName
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function isPerplexityCitationElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    const text = cleanPerplexityText(el.innerText || el.textContent || '').replace(/\s+/g, ' ');
    if (!isPerplexityCitationLikeLabel(text)) return false;
    if (/\+\d+\s*$/.test(text)) return true;

    const attrs = getPerplexityElementAttrs(el);
    if (/source|citation|cite|reference|badge|pill|rounded/.test(attrs)) return true;
    if (el.tagName === 'A') return true;

    return false;
  }

  function formatPerplexityCitation(label, href, sourceLinkMap) {
    const cleanLabel = escapeMarkdownLabel(label);
    if (!cleanLabel) return '';

    const baseLabel = cleanLabel.replace(/\s*\+\d+\s*$/, '').trim().toLowerCase();
    const baseWithoutTld = baseLabel.includes('.') ? baseLabel.split('.')[0] : baseLabel;
    const url = toAbsolutePerplexityUrl(href) ||
      sourceLinkMap.get(cleanLabel.toLowerCase()) ||
      sourceLinkMap.get(baseLabel) ||
      sourceLinkMap.get(baseWithoutTld) ||
      '';

    return url ? `([${cleanLabel}](${url}))` : `(${cleanLabel})`;
  }

  function extractPerplexityElementMarkdown(rootEl, sourceLinkMap) {
    const blockTags = new Set(['ARTICLE', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'P', 'SECTION']);

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const el = node;
      const tag = el.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(tag)) return '';
      if (el.getAttribute('aria-hidden') === 'true') return '';
      if (tag === 'BR') return '\n';

      if (isPerplexityCitationElement(el)) {
        const anchor = tag === 'A' ? el : (el.querySelector('a[href]') || el.closest('a[href]'));
        return formatPerplexityCitation(el.innerText || el.textContent || '', anchor ? anchor.getAttribute('href') : '', sourceLinkMap);
      }

      if (tag === 'A') {
        const label = escapeMarkdownLabel(el.innerText || el.textContent || 'Link');
        const url = toAbsolutePerplexityUrl(el.getAttribute('href'));
        if (!label) return '';
        if (!url) return label;
        return isPerplexityCitationLikeLabel(label) ? `([${label}](${url}))` : `[${label}](${url})`;
      }

      if (tag === 'IMG') {
        const alt = escapeMarkdownLabel(el.getAttribute('alt') || 'Image');
        const src = toAbsolutePerplexityUrl(el.getAttribute('src'));
        return src ? `![${alt}](${src})` : '';
      }

      const content = Array.from(el.childNodes).map(walk).join('');
      if (!content.trim()) return '';
      if (tag === 'LI') return `\n- ${content.trim()}\n`;
      if (['UL', 'OL'].includes(tag)) return `\n${content.trim()}\n`;
      if (blockTags.has(tag)) return `\n${content.trim()}\n`;
      return content;
    }

    return cleanPerplexityMarkdown(walk(rootEl));
  }

  function normalizePerplexityRole(role) {
    const value = String(role || '').toLowerCase();
    if (/user|human|query|question|prompt/.test(value)) return 'user';
    if (/assistant|answer|ai|bot|response|perplexity/.test(value)) return 'assistant';
    return null;
  }

  function getFirstString(obj, keys) {
    if (!obj || typeof obj !== 'object') return '';
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        const joined = value
          .map(item => typeof item === 'string' ? item : '')
          .filter(Boolean)
          .join('\n')
          .trim();
        if (joined) return joined;
      }
    }
    return '';
  }

  function getDeepText(value, depth = 0) {
    if (depth > 4 || value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map(item => getDeepText(item, depth + 1)).filter(Boolean).join('\n');
    }
    if (typeof value === 'object') {
      const direct = getFirstString(value, [
        'markdown', 'answer', 'response', 'content', 'text', 'body',
        'query', 'query_str', 'question', 'prompt', 'message'
      ]);
      if (direct) return direct;
      if (Array.isArray(value.parts)) return getDeepText(value.parts, depth + 1);
      if (Array.isArray(value.children)) return getDeepText(value.children, depth + 1);
    }
    return '';
  }

  function extractPerplexitySources(node) {
    const sources = [];
    const seen = new Set();

    function addSource(source) {
      if (!source || typeof source !== 'object') return;
      const url = getFirstString(source, ['url', 'link', 'source_url', 'display_url']);
      if (!url || seen.has(url)) return;
      seen.add(url);
      sources.push({
        url,
        title: getFirstString(source, ['title', 'name', 'display_name', 'site_name']) || url
      });
    }

    function walk(value, depth = 0) {
      if (depth > 5 || value == null) return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      if (typeof value !== 'object') return;
      addSource(value);
      for (const key of ['sources', 'citations', 'web_results', 'webResults', 'links', 'references']) {
        if (value[key]) walk(value[key], depth + 1);
      }
    }

    walk(node);
    return sources;
  }

  function pushPerplexityMessage(messages, seen, role, text, raw, sources) {
    const cleaned = cleanPerplexityText(text);
    if (!role || !cleaned || cleaned.length < 2) return;

    const key = `${role}:${cleaned}`;
    if (seen.has(key)) return;
    seen.add(key);

    messages.push({
      id: raw?.uuid || raw?.id || raw?.message_id || `perplexity-${messages.length}`,
      role,
      text: cleaned,
      createdAt: raw?.created_at || raw?.createdAt || raw?.timestamp || null,
      sources: Array.isArray(sources) ? sources : [],
      metadata: raw && typeof raw === 'object' ? { extractionHint: raw.type || raw.kind || null } : {}
    });
  }

  function extractPerplexityMessagesFromJson(root) {
    const messages = [];
    const seen = new Set();
    const userKeys = ['query_str', 'query', 'question', 'prompt', 'user_prompt', 'userQuery'];
    const assistantKeys = ['answer', 'response', 'final_answer', 'markdown_answer', 'bot_response', 'content'];

    function scan(node, depth = 0) {
      if (depth > 10 || node == null) return;

      if (Array.isArray(node)) {
        for (const item of node) scan(item, depth + 1);
        return;
      }

      if (typeof node !== 'object') return;

      const role = normalizePerplexityRole(node.role || node.author_role || node.sender || node.type || node.kind);
      if (role) {
        const roleText = getDeepText(node);
        pushPerplexityMessage(messages, seen, role, roleText, node, role === 'assistant' ? extractPerplexitySources(node) : []);
      }

      const queryText = getFirstString(node, userKeys);
      const answerText = getFirstString(node, assistantKeys);
      if (queryText && answerText && cleanPerplexityText(queryText) !== cleanPerplexityText(answerText)) {
        pushPerplexityMessage(messages, seen, 'user', queryText, node, []);
        pushPerplexityMessage(messages, seen, 'assistant', answerText, node, extractPerplexitySources(node));
      }

      for (const value of Object.values(node)) {
        if (value && (Array.isArray(value) || typeof value === 'object')) scan(value, depth + 1);
      }
    }

    scan(root);
    return messages;
  }

  function findPerplexityTitle(root, messages) {
    const fromDoc = document.title
      .replace(/\s*-\s*Perplexity\s*$/i, '')
      .replace(/^Perplexity\s*-\s*/i, '')
      .trim();
    if (fromDoc && fromDoc.toLowerCase() !== 'perplexity') return fromDoc;

    const direct = getFirstString(root, ['title', 'name', 'thread_title', 'display_title']);
    if (direct) return direct;

    const firstUser = messages.find(msg => msg.role === 'user' && msg.text);
    return firstUser ? firstUser.text.slice(0, 80) : 'Perplexity Conversation';
  }

  function getPerplexityDomText(el) {
    if (!el) return '';
    // Prefer textContent because innerText can reflect CSS line-clamp / visual truncation.
    return cleanPerplexityText(el.textContent || el.innerText || '');
  }

  function isLikelyTruncatedQuestion(text) {
    return /[.…]\s*$/.test(cleanPerplexityText(text));
  }

  function isBeforePerplexityElement(el, boundaryEl) {
    if (!el || !boundaryEl || el === boundaryEl) return false;
    if (el.contains(boundaryEl) || boundaryEl.contains(el)) return false;
    const pos = el.compareDocumentPosition(boundaryEl);
    return Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function getPerplexityVisibleQuestion(firstAssistantEl = null) {
    const candidates = [];
    const selectors = [
      'main [data-testid*="user" i]',
      'main [data-testid*="human" i]',
      'main [class*="user" i]',
      'main div',
      'main p'
    ];

    for (const selector of selectors) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          if (!(el instanceof HTMLElement)) continue;
          if (firstAssistantEl && !isBeforePerplexityElement(el, firstAssistantEl)) continue;
          if (['BUTTON', 'A', 'NAV', 'ASIDE'].includes(el.tagName)) continue;
          if (el.closest('button,a,nav,aside')) continue;
          const text = getPerplexityDomText(el);
          if (!text || isPerplexityNoise(text)) continue;
          if (text.length < 30 || text.length > 3000) continue;
          const attrs = getPerplexityElementAttrs(el);
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
          const topScore = rect ? Math.max(0, 1000 - Math.abs(rect.top)) : 0;
          const score = text.length + (/user|human|message/.test(attrs) ? 1000 : 0) + topScore + (isLikelyTruncatedQuestion(text) ? -500 : 0);
          candidates.push({ text, score });
        }
      } catch (e) {}
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].text;
    }

    const title = findPerplexityTitle({}, []);
    if (title && title !== 'Perplexity Conversation' && !isPerplexityNoise(title)) {
      return title;
    }

    return '';
  }

  function buildPerplexityPayload(root, conversationId, extraction) {
    const messages = extractPerplexityMessagesFromJson(root);
    return {
      source: 'perplexity',
      extraction,
      conversationId: conversationId || getPerplexityRouteId() || '',
      title: findPerplexityTitle(root, messages),
      messages,
      integrity: {
        status: messages.length > 0 ? 'probably-complete' : 'incomplete',
        warnings: extraction === 'network'
          ? []
          : ['Perplexity export used fallback extraction because no stable public conversation endpoint is available.']
      }
    };
  }

  function maybeCachePerplexityResponse(requestUrl, response) {
    try {
      if (!response || !response.ok) return;
      const contentType = response.headers && response.headers.get ? (response.headers.get('content-type') || '') : '';
      const looksRelevantUrl = /\/api\/|graphql|thread|conversation|query|search|answer/i.test(requestUrl);
      const looksJson = contentType.includes('json') || contentType.includes('application/javascript');
      if (!looksRelevantUrl && !looksJson) return;

      response.clone().json().then(data => {
        const conversationId = getPerplexityRouteId();
        const payload = buildPerplexityPayload(data, conversationId, 'network');
        if (payload.messages.length > 0) {
          const cacheKey = conversationId || payload.conversationId || PERPLEXITY_LAST_CACHE_KEY;
          conversationCache[cacheKey] = payload;
          conversationCache[PERPLEXITY_LAST_CACHE_KEY] = payload;
        }
      }).catch(() => {});
    } catch (e) {}
  }

  function extractPerplexityHydration(conversationId) {
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (nextDataEl && nextDataEl.textContent) {
      try {
        const data = JSON.parse(nextDataEl.textContent);
        const payload = buildPerplexityPayload(data, conversationId, 'hydration');
        if (payload.messages.length > 0) return payload;
      } catch (e) {}
    }

    const scripts = Array.from(document.scripts || []).filter(script => {
      const text = script.textContent || '';
      return text.includes('query') && (text.includes('answer') || text.includes('perplexity'));
    });

    for (const script of scripts) {
      const text = script.textContent || '';
      const jsonBlocks = text.match(/\{[\s\S]{80,}\}/g) || [];
      for (const block of jsonBlocks.slice(0, 5)) {
        try {
          const data = JSON.parse(block);
          const payload = buildPerplexityPayload(data, conversationId, 'hydration');
          if (payload.messages.length > 0) return payload;
        } catch (e) {}
      }
    }

    return null;
  }

  function isPerplexityNoise(text) {
    const compact = cleanPerplexityText(text).replace(/\s+/g, ' ').toLowerCase();
    if (!compact || compact.length < 2) return true;
    if (compact.length <= 80 && /^(home|discover|spaces|library|sign in|sign up|share|copy|rewrite|sources|related|images|videos|ask follow-up|ask follow up|follow-up|follow up|view sources|new thread|try pro|upgrade)$/.test(compact)) {
      return true;
    }
    return false;
  }

  function inferPerplexityDomRole(el) {
    const attrs = [
      el.getAttribute('data-testid'),
      el.getAttribute('aria-label'),
      typeof el.className === 'string' ? el.className : '',
      el.tagName
    ].filter(Boolean).join(' ').toLowerCase();

    if (/user|human/.test(attrs)) return 'user';
    if (/answer|assistant|response|markdown|prose|article/.test(attrs)) return 'assistant';
    return null;
  }

  function extractPerplexityFromDom(conversationId) {
    const root = document.querySelector('main') || document.body;
    const candidates = [];
    const sourceLinkMap = collectPerplexitySourceLinkMap();
    const selectors = [
      'main [data-testid*="user" i]',
      'main [data-testid*="human" i]',
      'main [data-testid*="answer" i]',
      'main [data-testid*="response" i]',
      'main article',
      'main .prose',
      'main [class*="prose" i]'
    ];

    for (const selector of selectors) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          if (!(el instanceof HTMLElement)) continue;
          const role = inferPerplexityDomRole(el);
          if (!role) continue;
          const text = role === 'assistant'
            ? extractPerplexityElementMarkdown(el, sourceLinkMap)
            : getPerplexityDomText(el);
          if (isPerplexityNoise(text)) continue;
          candidates.push({ el, role, text });
        }
      } catch (e) {}
    }

    candidates.sort((a, b) => {
      if (a.el === b.el) return 0;
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const messages = [];
    const seen = new Set();
    const firstAssistantCandidate = candidates.find(candidate => candidate.role === 'assistant');
    for (const candidate of candidates) {
      if (candidate.role === 'user' && firstAssistantCandidate && !isBeforePerplexityElement(candidate.el, firstAssistantCandidate.el)) {
        continue;
      }
      const duplicate = messages.some(msg => (
        msg.role === candidate.role &&
        (msg.text === candidate.text || msg.text.includes(candidate.text) || candidate.text.includes(msg.text))
      ));
      if (duplicate) continue;
      pushPerplexityMessage(messages, seen, candidate.role, candidate.text, null, []);
    }

    const hasUserMessage = messages.some(msg => msg.role === 'user');
    if (!hasUserMessage) {
      const visibleQuestion = getPerplexityVisibleQuestion(firstAssistantCandidate ? firstAssistantCandidate.el : null);
      const duplicatesAssistant = messages.some(msg => msg.role === 'assistant' && msg.text === visibleQuestion);
      if (visibleQuestion && !duplicatesAssistant) {
        messages.unshift({
          id: 'perplexity-user-from-title',
          role: 'user',
          text: visibleQuestion,
          createdAt: null,
          sources: [],
          metadata: { extractionHint: 'visible-title' }
        });
      }
    }

    if (messages.length === 0 && root) {
      const fallbackText = cleanPerplexityText(root.innerText || root.textContent || '');
      if (!isPerplexityNoise(fallbackText)) {
        pushPerplexityMessage(messages, seen, 'assistant', fallbackText, null, []);
      }
    }

    return {
      source: 'perplexity',
      extraction: 'dom',
      conversationId: conversationId || getPerplexityRouteId() || '',
      title: findPerplexityTitle({}, messages),
      messages,
      integrity: {
        status: messages.length > 1 ? 'probably-complete' : 'incomplete',
        warnings: ['Perplexity export used visible DOM fallback. If the exported thread is incomplete, scroll/open the full thread once and export again.']
      }
    };
  }

  async function fetchPerplexityConversation(conversationId) {
    const cached = conversationCache[conversationId] || conversationCache[PERPLEXITY_LAST_CACHE_KEY];
    if (cached && Array.isArray(cached.messages) && cached.messages.length > 0) {
      return cached;
    }

    const hydrated = extractPerplexityHydration(conversationId);
    if (hydrated && hydrated.messages.length > 0) {
      conversationCache[conversationId] = hydrated;
      return hydrated;
    }

    const domPayload = extractPerplexityFromDom(conversationId);
    if (domPayload.messages.length > 0) {
      conversationCache[conversationId] = domPayload;
      return domPayload;
    }

    throw new Error('Could not extract Perplexity conversation. Please open a thread, wait until it finishes loading, then try again.');
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
      const idPattern = platform === 'gemini'
        ? /^[a-zA-Z0-9_:-]+$/
        : (platform === 'perplexity' ? /^[a-zA-Z0-9_%:.~=-]+$/ : /^[a-f0-9-]+$/);
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

        // ChatGPT can issue partial conversation GETs while navigating a long
        // thread. Those responses still contain mapping/current_node and can
        // overwrite the earlier full snapshot, so they are not authoritative
        // for export. Always request the unparameterized full tree here.
        if (!platform || platform === 'chatgpt') {
          data = await fetchConversation(conversationId);
        } else if (!data) {
          if (platform === 'claude') {
            data = await fetchClaudeConversation(conversationId);
          } else if (platform === 'gemini') {
            data = await fetchGeminiConversation(conversationId);
          } else if (platform === 'perplexity') {
            data = await fetchPerplexityConversation(conversationId);
          }
        }

        if (platform === 'chatgpt') {
          data = await recoverChatGPTTemporaryConversation(data, conversationId);
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
