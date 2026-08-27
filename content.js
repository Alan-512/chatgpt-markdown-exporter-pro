(function() {
  // Generate a cryptographically secure token for cross-world message passing validation
  const secureToken = (typeof crypto !== 'undefined' && crypto.randomUUID) 
    ? crypto.randomUUID() 
    : Math.random().toString(36).substring(2) + Date.now().toString(36);

  // Dynamically inject inject.js at document_start to establish fetch hooks in the MAIN world
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.dataset.token = secureToken;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // Remove tag immediately to prevent page scripts from inspecting it
  } catch (e) {
    console.error('[Exporter] Failed to inject network interceptor:', e);
  }

  let container = null;
  let fab = null;
  let menu = null;
  let statusDot = null;
  let statusText = null;
  let observedTemporaryConversationId = null;
  let pendingTemporaryConversationId = null;
  let pendingTemporaryConversationUrl = null;
  let pendingTemporaryConversationAt = 0;
  const GEMINI_DOM_FALLBACK_ID = '__gemini_temp_dom__';

  // Active requests transaction map (prevents promise collisions and SPA race conditions)
  const pendingRequests = {};

  // Complete conversation payloads can take longer than the initial page
  // request, especially for long chats. Keep a bounded wait so slow valid
  // exports are not rejected while a missing injector still fails clearly.
  const EXPORT_REQUEST_TIMEOUT_MS = 30000;

  // Helper utility for asynchronous delays
  const delay = ms => new Promise(res => setTimeout(res, ms));

  // Security: Handle postMessage replies with strict origin and token validation
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    
    const message = event.data;
    if (message && message.type === 'OAI_CONVERSATION_ID') {
      // Security Check: Ignore conversation IDs that were not emitted by inject.js.
      const platform = getPlatform();
      if (message.token !== secureToken || (message.platform && message.platform !== platform)) return;
      if (!['chatgpt', 'gemini', 'claude', 'perplexity'].includes(platform)) return;

      const conversationId = extractConversationId(message.conversationId, platform);
      if (!conversationId) return;

      if (isTemporaryChat(platform)) {
        observedTemporaryConversationId = conversationId;
        pendingTemporaryConversationId = null;
        pendingTemporaryConversationUrl = null;
        pendingTemporaryConversationAt = 0;
        if (document.body) updateUIState();
      } else {
        // A provider can deliver the ID before React renders the temporary-mode
        // marker. Keep it briefly for the same page so that race does not
        // turn into a permanent "No conversation ID" state.
        pendingTemporaryConversationId = conversationId;
        pendingTemporaryConversationUrl = location.href;
        pendingTemporaryConversationAt = Date.now();
      }
      return;
    }

    if (message && message.type === 'OAI_EXPORT_RESPONSE') {
      // Security Check: Ignore message if token doesn't match
      if (message.token !== secureToken) return;

      const { requestId, success, data, error } = message;
      const request = pendingRequests[requestId];
      if (request) {
        clearTimeout(request.timeoutId);
        delete pendingRequests[requestId];

        // SPA Navigation check: Cancel if user navigated away while fetching
        if (getExportConversationId() !== request.conversationId) {
          request.reject(new Error('Export cancelled: Navigation detected.'));
          return;
        }

        if (success) {
          request.resolve(data);
        } else {
          request.reject(new Error(error || 'Failed to fetch conversation data.'));
        }
      }
    }
  });

  // Request the conversation data from inject.js running in MAIN world
  function requestConversationData(conversationId, platform) {
    const requestId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (pendingRequests[requestId]) {
          delete pendingRequests[requestId];
          reject(new Error(`Request timed out after ${EXPORT_REQUEST_TIMEOUT_MS / 1000} seconds. Please refresh the page and try again.`));
        }
      }, EXPORT_REQUEST_TIMEOUT_MS);

      pendingRequests[requestId] = { resolve, reject, timeoutId, conversationId };
      window.postMessage({ 
        type: 'OAI_EXPORT_REQUEST', 
        conversationId, 
        platform, 
        requestId,
        token: secureToken 
      }, window.location.origin);
    });
  }

  // Get active platform
  function getPlatform() {
    const host = window.location.hostname;
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('perplexity.ai')) return 'perplexity';
    return 'chatgpt';
  }

  const temporaryChatConfig = {
    chatgpt: {
      queryFlags: ['temporary-chat'],
      modePattern: /\btemporary(?:\s+chat)?\b|临时(?:聊天|对话)/i,
      activeModePattern: /\bturn\s+off\b.{0,40}\btemporary(?:\s+chat)?\b|关闭.{0,40}临时(?:聊天|对话)/i,
      idPattern: /^[a-f0-9-]+$/i
    },
    claude: {
      queryFlags: ['incognito'],
      modePattern: /\bincognito(?:\s+chat)?\b|隐身(?:聊天|对话)|无痕(?:聊天|对话)/i,
      activeModePattern: /\bturn\s+off\b.{0,40}\bincognito(?:\s+chat)?\b|关闭.{0,40}(?:隐身|无痕)(?:聊天|对话)?/i,
      idPattern: /^[a-f0-9-]+$/i
    },
    gemini: {
      queryFlags: ['temporary-chat'],
      modePattern: /\btemporary\s+chat\b|\bask\s+in\s+a\s+temporary\s+chat\b|临时(?:聊天|对话)/i,
      activeModePattern: /\bturn\s+off\b.{0,40}\btemporary\s+chat\b|关闭.{0,40}临时(?:聊天|对话)/i,
      idPattern: /^[a-zA-Z0-9_:-]+$/
    },
    perplexity: {
      queryFlags: ['incognito', 'temporary'],
      modePattern: /\bincognito(?:\s+mode)?\b|\btemporary\s+thread\b|隐身(?:模式|聊天|对话)|临时(?:线程|聊天|对话)/i,
      activeModePattern: /\bturn\s+off\b.{0,40}\bincognito(?:\s+mode)?\b|关闭.{0,40}(?:隐身|临时)(?:模式|线程|聊天|对话)?/i,
      idPattern: /^[a-zA-Z0-9_%:.~=-]+$/
    }
  };

  const temporaryRoutePatterns = {
    claude: /\/chat\/([a-f0-9-]+)/i,
    gemini: [
      /\/app\/([a-zA-Z0-9_:-]+)/i,
      /\/gem\/[^/?#]+\/([a-zA-Z0-9_:-]+)/i
    ],
    perplexity: [
      /\/(?:search|page)\/([a-zA-Z0-9_%:.~=-]+)/i
    ]
  };

  const inactiveTemporaryModeHints = {
    chatgpt: /\b(?:turn\s+on|start|enable|new)\b.{0,40}\btemporary(?:\s+chat)?\b|(?:开启|打开|开始|新建|启用).{0,40}临时(?:聊天|对话)/i,
    claude: /\b(?:start|enable|new)\b.{0,40}\bincognito\b|(?:开启|打开|开始|新建|启用).{0,40}(?:隐身|无痕)(?:聊天|对话)?/i,
    gemini: /\b(?:start|enable|new)\b.{0,40}\btemporary\s+chat\b|(?:开启|打开|开始|新建|启用).{0,40}临时(?:聊天|对话)/i,
    perplexity: /\b(?:enable|turn\s+on|start|new)\b.{0,40}\b(?:incognito|temporary\s+thread)\b|(?:开启|打开|开始|新建|启用).{0,40}(?:隐身|临时)(?:模式|线程|聊天|对话)?/i
  };

  const temporaryModeSelectors = [
    '[aria-label*="incognito" i]',
    '[aria-label*="隐身" i]',
    '[aria-label*="无痕" i]',
    '[aria-label*="temporary" i]',
    '[aria-label*="临时" i]',
    '[data-testid*="incognito" i]',
    '[data-testid*="隐身" i]',
    '[data-testid*="无痕" i]',
    '[data-testid*="temporary" i]',
    '[data-testid*="临时" i]',
    '[data-test-id*="incognito" i]',
    '[data-test-id*="隐身" i]',
    '[data-test-id*="无痕" i]',
    '[data-test-id*="temp" i]',
    '[data-test-id*="临时" i]',
    '[data-tooltip*="incognito" i]',
    '[data-tooltip*="temporary" i]',
    '[data-tooltip*="临时" i]',
    '[title*="incognito" i]',
    '[title*="隐身" i]',
    '[title*="无痕" i]',
    '[title*="temporary" i]',
    '[title*="临时" i]',
    '[placeholder*="temporary" i]',
    '[placeholder*="临时" i]',
    '[class*="incognito" i]',
    '[class*="temporary" i]',
    '[class*="临时" i]',
    '[role="status"]',
    '[role="banner"]',
    '[role="heading"]',
    'header',
    'h1',
    'h2',
    'h3',
    'main h1',
    'main h2',
    'button'
  ].join(', ');

  const temporaryConversationSelectors = [
    '[data-conversation-id]',
    '[data-chat-id]',
    '[data-thread-id]',
    '[aria-label*="chat-" i]',
    '[href*="/chat/"]',
    '[href*="/app/"]',
    '[href*="/gem/"]',
    '[href*="/search/"]',
    '[href*="/page/"]'
  ].join(', ');

  function hasQueryFlag(names) {
    const search = window.location.search || '';
    return names.some(name => new RegExp(`(?:\\?|&)${name}(?:=true)?(?:&|$)`, 'i').test(search));
  }

  function getElementAttributeText(element) {
    const attributes = [
      'aria-label', 'data-testid', 'data-test-id', 'data-tooltip',
      'title', 'placeholder'
    ];
    return [
      element.textContent,
      typeof element.className === 'string' ? element.className : '',
      ...attributes.map(name => element.getAttribute(name))
    ].filter(value => typeof value === 'string').join(' ');
  }

  function isActiveTemporaryModeElement(element, platform, pattern) {
    const text = getElementAttributeText(element);
    if (!pattern.test(text)) return false;

    const activeModePattern = temporaryChatConfig[platform]?.activeModePattern;
    if (activeModePattern?.test(text)) return true;

    const tagName = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
    const role = element.getAttribute('role');
    if (tagName === 'button' || role === 'button') {
      const state = [
        element.getAttribute('aria-pressed'),
        element.getAttribute('aria-current'),
        element.getAttribute('data-state'),
        element.getAttribute('data-active'),
        typeof element.className === 'string' ? element.className : ''
      ].filter(value => typeof value === 'string').join(' ');
      return /(?:true|active|selected|enabled|on)/i.test(state);
    }

    const inactiveHint = inactiveTemporaryModeHints[platform];
    return !(inactiveHint && inactiveHint.test(text));
  }

  function isTemporaryChat(platform = getPlatform()) {
    const config = temporaryChatConfig[platform];
    if (!config) return false;
    if (hasQueryFlag(config.queryFlags)) return true;

    return Array.from(document.querySelectorAll(temporaryModeSelectors))
      .some(element => isActiveTemporaryModeElement(element, platform, config.modePattern));
  }

  function extractConversationId(value, platform = getPlatform()) {
    if (typeof value !== 'string') return null;

    const text = value.trim();
    const prefixedMatch = text.match(/\bchat-([a-f0-9-]+)\b/i);
    if (prefixedMatch) return prefixedMatch[1];

    const patterns = temporaryRoutePatterns[platform];
    for (const pattern of (Array.isArray(patterns) ? patterns : [patterns])) {
      const routeMatch = pattern && text.match(pattern);
      if (routeMatch) return routeMatch[1];
    }

    const directPattern = (temporaryChatConfig[platform] || temporaryChatConfig.chatgpt).idPattern;
    return directPattern.test(text) ? text : null;
  }

  function getTemporaryConversationId(platform = getPlatform()) {
    const searchParams = new URL(window.location.href).searchParams;
    for (const queryKey of [
      'conversationId', 'conversation_id', 'chatId', 'chat_id',
      'threadId', 'thread_id'
    ]) {
      const id = extractConversationId(searchParams.get(queryKey), platform);
      if (id) return id;
    }

    // Network interception is the source of truth when a provider keeps the
    // temporary chat on a new-chat route. Its sidebar still contains links for
    // ordinary conversations, so treating the first route link as active can
    // export the wrong conversation.
    if (observedTemporaryConversationId) return observedTemporaryConversationId;
    if (
      pendingTemporaryConversationId &&
      pendingTemporaryConversationUrl === location.href &&
      Date.now() - pendingTemporaryConversationAt <= 10000
    ) {
      observedTemporaryConversationId = pendingTemporaryConversationId;
      pendingTemporaryConversationId = null;
      pendingTemporaryConversationUrl = null;
      pendingTemporaryConversationAt = 0;
      return observedTemporaryConversationId;
    }

    const usesCurrentPageSelectors = ['claude', 'gemini', 'perplexity'].includes(platform);
    const elements = document.querySelectorAll(
      usesCurrentPageSelectors
        ? 'main [data-conversation-id], main [data-chat-id], main [data-thread-id], main [aria-label*="chat-" i]'
        : temporaryConversationSelectors
    );
    const attributes = usesCurrentPageSelectors
      ? ['data-conversation-id', 'data-chat-id', 'data-thread-id', 'aria-label']
      : ['data-conversation-id', 'data-chat-id', 'data-thread-id', 'aria-label', 'href'];
    for (const element of elements) {
      for (const attribute of attributes) {
        const id = extractConversationId(element.getAttribute(attribute), platform);
        if (id) return id;
      }
    }

    // Gemini temporary chats stay on the new-chat route and may expose no
    // stable ID at all. The inject layer handles this sentinel by reading the
    // current page's message nodes, never the sidebar.
    if (platform === 'gemini' && isTemporaryChat(platform)) {
      return GEMINI_DOM_FALLBACK_ID;
    }

    return null;
  }

  // Get the active conversation ID from the route or temporary-chat DOM state
  function getActiveConversationId() {
    const platform = getPlatform();
    if (platform === 'claude') {
      const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
      if (match) return match[1];
      return isTemporaryChat(platform) ? getTemporaryConversationId(platform) : null;
    }
    if (platform === 'gemini') {
      const path = window.location.pathname.replace(/\/+$/, '');
      const segs = path.split('/').filter(Boolean);
      if (segs.length === 0) {
        return isTemporaryChat(platform) ? getTemporaryConversationId(platform) : null;
      }
      let i = 0;
      if (segs[0] === 'u' && /^\d+$/.test(segs[1] || '')) {
        i = 2;
      }
      if (segs[i] === 'app' && segs[i + 1]) {
        return segs[i + 1];
      }
      if (segs[i] === 'gem' && segs[i + 1] && segs[i + 2]) {
        return segs[i + 2];
      }
      return isTemporaryChat(platform) ? getTemporaryConversationId(platform) : null;
    }
    if (platform === 'perplexity') {
      const path = window.location.pathname.replace(/\/+$/, '');
      const segs = path.split('/').filter(Boolean);
      if (segs.length === 0) {
        return isTemporaryChat(platform) ? getTemporaryConversationId(platform) : null;
      }

      const threadRouteIndex = segs.findIndex(seg => seg === 'search' || seg === 'page');
      if (threadRouteIndex >= 0 && segs[threadRouteIndex + 1]) {
        return segs[threadRouteIndex + 1];
      }

      const first = segs[0];
      const unsupportedRoots = new Set([
        'account', 'api', 'collections', 'discover', 'enterprise',
        'help', 'hub', 'library', 'login', 'settings', 'spaces'
      ]);

      // Keep this permissive for Perplexity's changing route names while hiding obvious non-thread pages.
      if (segs.length === 1 && !unsupportedRoots.has(first)) {
        return first;
      }

      if (segs.length > 1 && !unsupportedRoots.has(first)) {
        return segs[segs.length - 1];
      }

      return isTemporaryChat(platform) ? getTemporaryConversationId(platform) : null;
    }
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    if (match) return match[1];
    return isTemporaryChat(platform) ? getTemporaryConversationId(platform) : null;
  }

  // Gemini temporary chats intentionally stay on the new-chat route and may
  // never expose a conversation ID. Keep the DOM fallback authoritative for
  // the export transaction even if provider-specific message selectors are
  // delayed or changed after the UI is mounted.
  function getExportConversationId() {
    const platform = getPlatform();
    const activeId = getActiveConversationId();
    if (activeId) return activeId;
    return platform === 'gemini' && isTemporaryChat(platform)
      ? GEMINI_DOM_FALLBACK_ID
      : null;
  }

  // Sanitize filename for downloading
  function sanitizeFilename(name) {
    if (!name) return 'chatgpt-export';
    return name
      .trim()
      .replace(/[\\/*?:"<>|]/g, '') // Remove invalid chars
      .replace(/\s+/g, '-')          // Replace spaces with dashes
      .substring(0, 50);             // Max 50 chars
  }

  // Set status indicator in the UI
  function setStatus(state, text) {
    if (!statusDot || !statusText) return;

    statusDot.className = 'oai-exporter-status-dot';
    statusText.innerText = text;

    if (state === 'loading') {
      statusDot.classList.add('loading');
    } else if (state === 'error') {
      statusDot.classList.add('error');
    }
  }

  // Find the primary scrollable container in ChatGPT DOM (Section 17)
  function findScrollContainer() {
    const main = document.querySelector('main');
    if (main) {
      const scrollable = main.querySelector('.react-scroll-to-bottom--css-item-child') || 
                         main.querySelector('.overflow-y-auto') || main;
      return scrollable;
    }
    return window;
  }

  // Parse complex content parts into markdown or readable placeholders (Section 8)
  function parseContentPart(part) {
    if (typeof part === 'string') return part;
    if (typeof part === 'object' && part !== null) {
      const contentType = part.content_type || part.type || '';
      const assetPointer = part.asset_pointer || part.image_asset_pointer || part.file_id || '';

      if (part.content_type === 'image') {
        if (part.url) {
          return `![Generated Image](${part.url})\n\n*Prompt: ${part.prompt || ''}*`;
        }
        return part.prompt ? `[Generated image: ${part.prompt}]` : '[Generated image]';
      }

      if (/image|asset_pointer/.test(contentType) || /image|file-service|asset/.test(assetPointer)) {
        return '[Image attached]';
      }

      if (part.name) {
        return `[Attachment: ${part.name}]`;
      }
      if (part.content_type === 'citation') {
        return `[Citation: ${part.text || 'Reference'}]`;
      }
      // General metadata placeholder instead of dumping JSON.stringify
      return contentType ? `[Attachment: ${contentType}]` : '[Attachment]';
    }
    return '';
  }

  function cleanMediaPlaceholders(text) {
    if (!text) return '';
    return text
      .replace(/\[Media Content:\s*(image_asset_pointer|asset_pointer|image|input_image)\]/gi, '[Image attached]')
      .replace(/\[Attachment:\s*(image_asset_pointer|asset_pointer|input_image)\]/gi, '[Image attached]')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Resolve and clean inline citation unicode tags (e.g. \uE200cite\uE202...)
  function cleanCitations(text, contentRefs) {
    if (!text) return '';
    let cleanedText = text;

    if (contentRefs && contentRefs.length > 0) {
      for (const ref of contentRefs) {
        if (ref.matched_text && cleanedText.includes(ref.matched_text)) {
          let url = '';
          let label = '';
          
          if (ref.items && ref.items.length > 0) {
            const firstItem = ref.items[0];
            url = firstItem.url || (ref.safe_urls && ref.safe_urls[0]) || '';
            label = firstItem.attribution || firstItem.title || 'Reference';
          } else if (ref.safe_urls && ref.safe_urls.length > 0) {
            url = ref.safe_urls[0];
            try {
              label = new URL(url).hostname.replace('www.', '');
            } catch (e) {
              label = 'Reference';
            }
          }

          if (url && label) {
            const parts = ref.matched_text.replace(/[\uE200\uE201]/g, '').split('\uE202');
            const count = parts.length - 1;
            const extra = count > 1 ? `+${count - 1}` : '';
            const markdownLink = `[${label}${extra}](${url})`;
            cleanedText = cleanedText.split(ref.matched_text).join(markdownLink);
          }
        }
      }
    }

    // Strip any remaining/unresolved citation tags
    cleanedText = cleanedText.replace(/\uE200[^\uE201]*\uE201/g, '');

    // Strip leftover citation control characters to be absolutely clean
    cleanedText = cleanedText.replace(/[\uE200-\uE202]/g, '');

    return cleanedText;
  }

  // Normalize the raw API JSON data into the standardized internal message model (Section 7)
  function normalizeConversation(data) {
    const mapping = data.mapping;
    const currentNodeId = data.current_node;
    const conversationId = getActiveConversationId() || data.conversation_id || '';
    const domFallback = data.extraction === 'dom';
    
    const result = {
      conversationId: conversationId,
      title: data.title || 'ChatGPT Conversation',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      source: domFallback ? 'dom' : 'network',
      messages: [],
      raw: data,
      integrity: {
        status: domFallback ? (data.integrity?.status || 'probably-complete') : 'complete',
        warnings: Array.isArray(data.integrity?.warnings) ? data.integrity.warnings : []
      }
    };

    if (!mapping || !currentNodeId) {
      result.integrity.status = 'incomplete';
      result.integrity.warnings.push('Missing mapping or current_node in the payload.');
      return result;
    }

    // Traverse the conversation tree backwards from current leaf node to root
    const nodes = [];
    const visited = new Set();
    let nodeId = currentNodeId;
    while (nodeId) {
      if (visited.has(nodeId)) {
        result.integrity.status = 'incomplete';
        result.integrity.warnings.push(`Cycle detected in the active message path at node ${nodeId}.`);
        break;
      }
      visited.add(nodeId);

      const node = mapping[nodeId];
      if (!node) {
        result.integrity.status = 'incomplete';
        result.integrity.warnings.push(`Missing parent node ${nodeId} in the active message path.`);
        break;
      }

      nodes.push(node);
      nodeId = node.parent || null;
    }
    nodes.reverse(); // Convert to chronological order

    if (nodes.length === 0) {
      result.integrity.status = 'incomplete';
      result.integrity.warnings.push('Traversed active message path is empty.');
      return result;
    }

    let messageIndex = 0;
    for (const node of nodes) {
      const message = node.message;
      if (!message) continue;

      const role = message.author ? message.author.role : '';
      if (role === 'system') continue;

      const isCode = message.recipient === 'python' || (message.content && message.content.content_type === 'code');
      // Skip non-Python tool messages (e.g. browser/web search tool queries)
      if (role === 'tool' && !isCode) continue;

      // Extract text content
      let text = '';
      if (message.content && message.content.parts) {
        text = message.content.parts.map(part => parseContentPart(part)).join('\n');
      }

      text = cleanMediaPlaceholders(text);

      // Handle empty messages running code interpreter
      if (!text.trim() && role === 'assistant' && message.metadata && message.metadata.command) {
        text = message.metadata.command;
      }

      // Clean citations in message text (Issue resolution for sentence-end garbage chars)
      if (role === 'assistant' && message.metadata) {
        text = cleanCitations(text, message.metadata.content_references);
      } else if (text.includes('\uE200')) {
        text = text.replace(/\uE200[^\uE201]*\uE201/g, '').replace(/[\uE200-\uE202]/g, '');
      }

      text = cleanMediaPlaceholders(text);

      const contentType = isCode ? 'code' : (role === 'tool' ? 'tool' : 'markdown');

      const normalizedMsg = {
        id: message.id || node.id || `msg-${messageIndex}`,
        parentId: node.parent || null,
        index: messageIndex++,
        role: role || 'unknown',
        createdAt: message.create_time ? new Date(message.create_time * 1000).toISOString() : null,
        content: [
          {
            type: contentType,
            text: text,
            language: isCode ? 'python' : null,
            metadata: message.metadata || {}
          }
        ],
        raw: message,
        hash: ''
      };

      result.messages.push(normalizedMsg);
    }

    // Perform Integrity Checks (Section 9)
    const messages = result.messages;
    if (messages.length === 0) {
      result.integrity.status = 'incomplete';
      result.integrity.warnings.push('No valid user, assistant, or tool messages resolved.');
    } else {
      // 2. Check if first message is from User
      if (messages[0].role !== 'user') {
        if (result.integrity.status === 'complete') {
          result.integrity.status = 'probably-complete';
        }
        result.integrity.warnings.push('Sequence anomaly: Conversation does not start with a User message.');
      }

      // 3. Check if last message leaves user hanging
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        if (result.integrity.status === 'complete') {
          result.integrity.status = 'probably-complete';
        }
        result.integrity.warnings.push('Sequence anomaly: Conversation ends with a User message (missing final response).');
      }
    }

    return result;
  }

  // Clean and convert Claude's XML <antArtifact> tags into standard Markdown elements
  function cleanClaudeArtifacts(text) {
    if (!text) return '';
    let cleaned = text;

    // Regex to find all antArtifact blocks and parse their attributes
    const artifactRegex = /<antArtifact\s+([^>]*?)>([\s\S]*?)<\/antArtifact>/gi;

    cleaned = cleaned.replace(artifactRegex, (match, attrsStr, content) => {
      // Parse attributes
      const attrs = {};
      const attrRegex = /(\w+)="([^"]*)"/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
      }

      const type = attrs.type || '';
      const title = attrs.title || 'Artifact';
      const lang = attrs.language || '';
      const code = content.trim();

      // 1. SVG Vector graphics - Keep raw SVG tag and strip antArtifact wrapper so it renders in markdown
      if (type === 'image/svg+xml' || code.startsWith('<svg')) {
        return `\n\n<!-- Artifact: ${title} -->\n${code}\n\n`;
      }

      // 2. Mermaid diagram - Render as standard Markdown Mermaid code block
      if (lang === 'mermaid') {
        return `\n\n### Artifact: ${title}\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n`;
      }

      // 3. React components - Wrap in jsx code blocks
      if (type.includes('react') || type.includes('jsx')) {
        return `\n\n### Artifact: ${title} (React Component)\n\n\`\`\`jsx\n${code}\n\`\`\`\n\n`;
      }

      // 4. HTML pages - Wrap in html code blocks
      if (type === 'text/html') {
        return `\n\n### Artifact: ${title} (HTML)\n\n\`\`\`html\n${code}\n\`\`\`\n\n`;
      }

      // 5. Code blocks (e.g. vnd.ant.code)
      if (type.includes('code') || lang) {
        const codeLang = lang || 'javascript';
        return `\n\n### Artifact: ${title}\n\n\`\`\`${codeLang}\n${code}\n\`\`\`\n\n`;
      }

      // 6. Markdown - Keep as is
      if (type === 'text/markdown') {
        return `\n\n### Artifact: ${title}\n\n${code}\n\n`;
      }

      // Fallback - wrap in generic code block if it looks like code/tags, else plain text
      if (code.startsWith('<') || code.includes('import ') || code.includes('export ')) {
        return `\n\n### Artifact: ${title}\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
      }

      return `\n\n### Artifact: ${title}\n\n${code}\n\n`;
    });

    // Clean remaining tags if any
    cleaned = cleaned.replace(/<\/?antArtifact[^>]*>/gi, '');

    return cleaned;
  }

  // Normalize Claude's JSON data into the standardized internal model
  function normalizeClaudeConversation(payload, conversationId, includeThinking = false) {
    const rawData = payload.data || payload;
    const result = {
      conversationId: conversationId,
      title: rawData.name || 'Claude Conversation',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      source: 'network',
      messages: [],
      raw: rawData,
      integrity: {
        status: 'complete',
        warnings: []
      }
    };

    const chatMessages = rawData.chat_messages || [];
    let messageIndex = 0;

    for (const msg of chatMessages) {
      const sender = msg.sender;
      if (sender !== 'human' && sender !== 'assistant') continue;

      const role = sender === 'human' ? 'user' : 'assistant';
      let text = '';
      let thoughtsText = '';

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            text += (block.text || '') + '\n\n';
          } else if (block.type === 'thinking') {
            thoughtsText += (block.thinking || '') + '\n\n';
          } else if (block.type === 'redacted_thinking') {
            thoughtsText += '*[Thinking process redacted]*\n\n';
          }
        }
      } else if (typeof msg.text === 'string') {
        text = msg.text;
      }

      text = text.trim();
      text = cleanClaudeArtifacts(text);
      thoughtsText = thoughtsText.trim();

      if (thoughtsText && includeThinking) {
        text = `<details>\n<summary>Thinking Process</summary>\n\n${thoughtsText}\n</details>\n\n${text}`;
      }

      if (msg.attachments && msg.attachments.length > 0) {
        const attachmentTexts = msg.attachments.map(att => {
          return `[Attachment: ${att.file_name || att.name || 'file'}]`;
        }).join('\n');
        if (text) {
          text = text + '\n\n' + attachmentTexts;
        } else {
          text = attachmentTexts;
        }
      }

      const normalizedMsg = {
        id: msg.uuid || `claude-msg-${messageIndex}`,
        parentId: null,
        index: messageIndex++,
        role: role,
        createdAt: msg.created_at || null,
        content: [
          {
            type: 'markdown',
            text: text
          }
        ],
        raw: msg
      };

      result.messages.push(normalizedMsg);
    }

    return result;
  }

  // Normalize Gemini's batchexecute blocks into the standardized internal model
  function normalizeGeminiConversation(payload, chatId, includeThinking = false) {
    const domFallback = payload.extraction === 'dom';
    const result = {
      conversationId: chatId,
      title: payload.title || 'Gemini Conversation',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      source: domFallback ? 'dom' : 'network',
      messages: [],
      raw: payload,
      integrity: {
        status: domFallback ? 'probably-complete' : 'complete',
        warnings: Array.isArray(payload.integrity?.warnings)
          ? payload.integrity.warnings
          : []
      }
    };

    const blocks = payload.blocks || [];
    let messageIndex = 0;

    for (const block of blocks) {
      const userMsg = {
        id: `gemini-user-${messageIndex}`,
        parentId: null,
        index: messageIndex++,
        role: 'user',
        createdAt: block.tsPair ? new Date(block.tsPair[0] * 1000).toISOString() : null,
        content: [
          {
            type: 'markdown',
            text: block.userText || ''
          }
        ],
        raw: block
      };
      result.messages.push(userMsg);

      let assistantText = block.assistantText || '';
      if (includeThinking && block.thoughtsText && block.thoughtsText.trim()) {
        assistantText = `<details>\n<summary>Thinking Process</summary>\n\n${block.thoughtsText.trim()}\n</details>\n\n${assistantText}`;
      }

      const assistantMsg = {
        id: `gemini-assistant-${messageIndex}`,
        parentId: `gemini-user-${messageIndex - 1}`,
        index: messageIndex++,
        role: 'assistant',
        createdAt: block.tsPair ? new Date(block.tsPair[0] * 1000).toISOString() : null,
        content: [
          {
            type: 'markdown',
            text: assistantText
          }
        ],
        raw: block
      };
      result.messages.push(assistantMsg);
    }

    return result;
  }

  function stripPerplexityCitationLinks(text) {
    if (!text) return '';
    return text
      .replace(/\n\n\*\*Sources:\*\*[\s\S]*$/i, '')
      .replace(/\s*\(\[[^\]\n]{1,120}\]\((?:https?:\/\/|\/)[^)]+\)\)/g, '')
      .replace(/\s*\(\[[^\]\n]{1,120}\]\)\((?:https?:\/\/|\/)[^)]+\)/g, '')
      .replace(/\s*\([a-z0-9][a-z0-9.-]{2,}(?:\s*\+\d+)?\)/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function stripCitationLinksForMarkdown(text) {
    if (!text) return '';
    return text
      // Remove generated source/reference sections.
      .replace(/\n\n\*\*(Sources|References|Citations):\*\*[\s\S]*$/i, '')
      // Remove inline citation links in parentheses, e.g. ([source +2](https://...)).
      .replace(/\s*\(\[[^\]\n]{1,120}\]\((?:https?:\/\/|\/)[^)]+\)\)/g, '')
      // Remove malformed split citation links from pasted rich text, e.g. ([source])(https://...).
      .replace(/\s*\(\[[^\]\n]{1,120}\]\)\((?:https?:\/\/|\/)[^)]+\)/g, '')
      // Remove Perplexity-style unresolved source pills, e.g. (terralogic +2).
      .replace(/\s*\([a-z0-9][a-z0-9.-]{2,}(?:\s*\+\d+)?\)/gi, '')
      // Convert remaining ordinary Markdown links to readable labels instead of URLs.
      .replace(/\[([^\]\n]{1,160})\]\((?:https?:\/\/|\/)[^)]+\)/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Normalize Perplexity's extracted thread data into the standardized internal model
  function normalizePerplexityConversation(payload, conversationId, includeCitationLinks = true) {
    const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const result = {
      conversationId: conversationId,
      title: payload.title || 'Perplexity Conversation',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      source: payload.extraction || 'network-or-dom',
      messages: [],
      raw: payload,
      integrity: payload.integrity || {
        status: rawMessages.length > 0 ? 'probably-complete' : 'incomplete',
        warnings: rawMessages.length > 0 ? [] : ['No Perplexity messages were extracted.']
      }
    };

    let messageIndex = 0;
    for (const msg of rawMessages) {
      if (!msg || !msg.text || !msg.text.trim()) continue;
      const role = msg.role === 'user' ? 'user' : 'assistant';
      let text = includeCitationLinks ? msg.text.trim() : stripPerplexityCitationLinks(msg.text);
      if (!text.trim()) continue;

      if (includeCitationLinks && role === 'assistant' && Array.isArray(msg.sources) && msg.sources.length > 0) {
        const sourceLines = msg.sources
          .filter(source => source && source.url)
          .map((source, i) => {
            const label = source.title || source.name || source.url;
            return `${i + 1}. [${label}](${source.url})`;
          });
        if (sourceLines.length > 0) {
          text += `\n\n**Sources:**\n${sourceLines.join('\n')}`;
        }
      }

      result.messages.push({
        id: msg.id || `perplexity-msg-${messageIndex}`,
        parentId: null,
        index: messageIndex++,
        role,
        createdAt: msg.createdAt || null,
        content: [
          {
            type: 'markdown',
            text,
            metadata: msg.metadata || {}
          }
        ],
        raw: msg
      });
    }

    if (result.messages.length === 0) {
      result.integrity.status = 'incomplete';
      result.integrity.warnings = result.integrity.warnings || [];
      result.integrity.warnings.push('No valid Perplexity user or assistant messages resolved.');
    } else if (result.integrity.status === 'complete' && payload.extraction === 'dom') {
      result.integrity.status = 'probably-complete';
      result.integrity.warnings = result.integrity.warnings || [];
      result.integrity.warnings.push('Perplexity export used DOM fallback because no complete internal payload was available. Very long virtualized threads may require opening the full thread first.');
    }

    return result;
  }

  // Format the normalized message model into a clean, presentation-ready Markdown string (Matching standard ChatGPT export style)
  function convertNormalizedToMarkdown(model, options = {}) {
    const includeCitationLinks = options.includeCitationLinks !== false;
    const includeMetadata = options.includeMetadata !== false;
    const assistantRepliesOnly = options.assistantRepliesOnly === true;
    const platform = getPlatform();
    let markdown = `# ${model.title}\n\n`;

    if (includeMetadata) {
      markdown += `- **Source URL:** [Link](${model.url})\n`;
      markdown += `- **Exported At:** ${new Date(model.exportedAt).toLocaleString()}\n`;
      markdown += `- **Platform:** ${platform.toUpperCase()}\n`;

      const integrityStatus = model.integrity ? model.integrity.status : 'complete';
      const warnings = model.integrity && Array.isArray(model.integrity.warnings) ? model.integrity.warnings : [];
      if (integrityStatus && integrityStatus !== 'complete') {
        markdown += `- **Integrity Status:** ${integrityStatus}\n`;
      }
      if (warnings.length > 0) {
        markdown += `- **Warnings:**\n`;
        warnings.forEach(w => {
          markdown += `  - ${w}\n`;
        });
      }
      markdown += `\n---\n\n`;
    } else {
      markdown += `\n`;
    }

    let lastAuthor = null;

    for (const msg of model.messages) {
      const role = msg.role;
      const contentItem = msg.content[0] || { text: '', type: 'markdown' };
      const text = includeCitationLinks ? contentItem.text.trim() : stripCitationLinksForMarkdown(contentItem.text);

      // Skip empty messages or system messages
      if (!text || role === 'system') continue;
      if (assistantRepliesOnly && role !== 'assistant') continue;

      // Handle tool / code interpreter output
      if (role === 'tool') {
        markdown += `**Code Interpreter / Tool Output:**\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
        lastAuthor = 'tool';
        continue;
      }

      let assistantName = 'Assistant';
      if (platform === 'claude') {
        assistantName = 'Claude';
      } else if (platform === 'gemini') {
        assistantName = 'Gemini';
      } else if (platform === 'perplexity') {
        assistantName = 'Perplexity';
      } else {
        assistantName = 'ChatGPT';
      }
      const authorLabel = role === 'user' ? '**You:**' : `**${assistantName}:**`;

      if (lastAuthor === authorLabel) {
        // Merge consecutive messages from the same role to keep markdown clean and readable
        if (contentItem.type === 'code') {
          markdown += `\`\`\`python\n${text}\n\`\`\`\n\n`;
        } else {
          markdown += `${text}\n\n`;
        }
      } else {
        // Add a separator between turns (except before the first message)
        if (lastAuthor !== null) {
          markdown += `* * *\n\n`;
        }

        markdown += `${authorLabel}\n\n`;
        if (contentItem.type === 'code') {
          markdown += `\`\`\`python\n${text}\n\`\`\`\n\n`;
        } else {
          markdown += `${text}\n\n`;
        }
        lastAuthor = authorLabel;
      }
    }

    return markdown;
  }

  // Trigger file download in browser
  function triggerDownload(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (error) {
      console.warn('[Exporter] Clipboard API unavailable; trying focused fallback.', error);
    }

    if (!document.body || typeof document.createElement !== 'function') {
      throw new Error('Unable to copy Markdown to the clipboard. Please use Export Markdown instead.');
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute?.('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    const previousActiveElement = document.activeElement;
    let copied = false;
    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } finally {
      textarea.remove();
      previousActiveElement?.focus?.({ preventScroll: true });
    }

    if (!copied) {
      throw new Error('Unable to copy Markdown to the clipboard. Please use Export Markdown instead.');
    }
  }

  let isExporting = false;

  // Core handler for exporting
  async function performExport(format, action = 'download') {
    if (isExporting) return;

    const platform = getPlatform();
    const conversationId = getExportConversationId();
    if (!conversationId) {
      setStatus('error', 'No conversation ID');
      return;
    }

    isExporting = true;
    setStatus('loading', 'Loading data...');
    try {
      const rawData = await requestConversationData(conversationId, platform);
      
      const includeThinkingCheckbox = document.getElementById('oai-exporter-include-thinking');
      const includeThinking = includeThinkingCheckbox ? includeThinkingCheckbox.checked : false;
      const includeCitationsCheckbox = document.getElementById('oai-exporter-include-citations');
      const includeCitationLinks = includeCitationsCheckbox ? includeCitationsCheckbox.checked : true;
      const includeMetadata = true;
      const assistantOnlyCheckbox = document.getElementById('oai-exporter-assistant-only');
      const assistantRepliesOnly = assistantOnlyCheckbox ? assistantOnlyCheckbox.checked : false;

      let model;
      if (platform === 'claude') {
        model = normalizeClaudeConversation(rawData, conversationId, includeThinking);
      } else if (platform === 'gemini') {
        model = normalizeGeminiConversation(rawData, conversationId, includeThinking);
      } else if (platform === 'perplexity') {
        model = normalizePerplexityConversation(rawData, conversationId, includeCitationLinks);
      } else {
        model = normalizeConversation(rawData);
      }
      
      if (format === 'markdown') {
        const markdown = convertNormalizedToMarkdown(model, {
          includeCitationLinks,
          includeMetadata,
          assistantRepliesOnly
        });
        if (action === 'download') {
          const filename = `${sanitizeFilename(model.title)}_${new Date().toISOString().slice(0, 10)}.md`;
          triggerDownload(markdown, filename, 'text/markdown;charset=utf-8');
          setStatus('ready', `Exported MD! (${model.integrity.status || 'complete'})`);
        } else if (action === 'copy') {
          await copyTextToClipboard(markdown);
          setStatus('ready', 'Copied to clipboard!');
        }
      } else if (format === 'json') {
        const filename = `${sanitizeFilename(model.title)}_${new Date().toISOString().slice(0, 10)}.json`;
        triggerDownload(JSON.stringify(model, null, 2), filename, 'application/json;charset=utf-8');
        setStatus('ready', `Exported JSON! (${model.integrity.status || 'complete'})`);
      }

      // Reset to ready status after a short delay
      setTimeout(() => setStatus('ready', 'Ready'), 2500);
    } catch (err) {
      console.error('[Exporter] Export failed:', err);
      setStatus('error', err.message || 'Export failed');
      setTimeout(() => setStatus('ready', 'Ready'), 4000);
    } finally {
      isExporting = false;
    }
  }

  // Initialize and inject the UI elements into the page
  function initUI() {
    if (document.getElementById('oai-exporter-container')) return;
    if (!document.body) return;

    container = document.createElement('div');
    container.id = 'oai-exporter-container';

    // SVG Icons
    const downloadIcon = `<svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>`;
    const mdIcon = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="15.5" font-family="system-ui, sans-serif" font-size="10" font-weight="900" text-anchor="middle">MD</text></svg>`;
    const jsonIcon = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="15" font-family="system-ui, sans-serif" font-size="9" font-weight="900" text-anchor="middle">{ }</text></svg>`;
    const copyIcon = `<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a1.5 1.5 0 00-1.5-1.5h-7A1.5 1.5 0 006 6v7a1.5 1.5 0 001.5 1.5H8" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;

    container.innerHTML = `
      <div class="oai-exporter-fab" title="Export conversation">
        ${downloadIcon}
        <div class="oai-exporter-tooltip">Export Chat</div>
      </div>
      <div class="oai-exporter-menu">
        <div class="oai-exporter-header">Export Options</div>
        <button class="oai-exporter-item btn-md">
          ${mdIcon}
          Export Markdown (.md)
        </button>
        <button class="oai-exporter-item btn-json">
          ${jsonIcon}
          Export Raw JSON (.json)
        </button>
        <button class="oai-exporter-item btn-copy">
          ${copyIcon}
          Copy Markdown
        </button>
        
        <div class="oai-exporter-divider"></div>
        <div class="oai-exporter-checkbox-container">
          <label class="oai-exporter-checkbox-label">
            <input type="checkbox" id="oai-exporter-include-thinking" />
            <span>Include Thinking Process</span>
          </label>
          <label class="oai-exporter-checkbox-label">
            <input type="checkbox" id="oai-exporter-include-citations" checked />
            <span>Include Citation Links</span>
          </label>
          <label class="oai-exporter-checkbox-label">
            <input type="checkbox" id="oai-exporter-assistant-only" />
            <span>Assistant Replies Only</span>
          </label>
        </div>
        
        <div class="oai-exporter-divider"></div>
        <div class="oai-exporter-status">
          <div class="oai-exporter-status-dot"></div>
          <span class="oai-exporter-status-text">Ready</span>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    fab = container.querySelector('.oai-exporter-fab');
    menu = container.querySelector('.oai-exporter-menu');
    statusDot = container.querySelector('.oai-exporter-status-dot');
    statusText = container.querySelector('.oai-exporter-status-text');

    // Click handler for FAB
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.toggle('show');
      fab.classList.toggle('open', isOpen);
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (container && !container.contains(e.target)) {
        if (menu) menu.classList.remove('show');
        if (fab) fab.classList.remove('open');
      }
    });

    // Action button clicks (API path)
    container.querySelector('.btn-md').addEventListener('click', (e) => {
      e.stopPropagation();
      performExport('markdown', 'download');
    });

    container.querySelector('.btn-json').addEventListener('click', (e) => {
      e.stopPropagation();
      performExport('json', 'download');
    });

    container.querySelector('.btn-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      performExport('markdown', 'copy');
    });
  }

  // Display or hide the FAB based on page state
  function updateUIState() {
    const platform = getPlatform();
    const temporaryChat = isTemporaryChat(platform);
    const conversationId = getActiveConversationId();
    // A private/temporary page is already a valid export context even while
    // ChatGPT is still resolving its non-routable conversation ID. Keep the
    // control visible so a late network ID can finish the export path.
    if (conversationId || temporaryChat) {
      if (!document.getElementById('oai-exporter-container')) {
        initUI();
      }
      if (container) {
        container.style.display = 'block';
      }
    } else {
      if (container) {
        container.style.display = 'none';
        if (menu) menu.classList.remove('show');
        if (fab) fab.classList.remove('open');
      }
    }
  }

  // Performance-friendly URL polling replacing heavy MutationObserver (Issue 6)
  let lastUrl = location.href;
  let lastTemporaryChat = false;
  let lastTemporaryConversationId = null;
  setInterval(() => {
    const url = location.href;
    if (url !== lastUrl) {
      observedTemporaryConversationId = null;
      pendingTemporaryConversationId = null;
      pendingTemporaryConversationUrl = null;
      pendingTemporaryConversationAt = 0;
    } else if (
      pendingTemporaryConversationId &&
      Date.now() - pendingTemporaryConversationAt > 10000
    ) {
      pendingTemporaryConversationId = null;
      pendingTemporaryConversationUrl = null;
      pendingTemporaryConversationAt = 0;
    }
    const platform = getPlatform();
    const shouldCheckTemporaryChat =
      url !== lastUrl ||
      lastTemporaryChat ||
      !document.getElementById('oai-exporter-container');
    const temporaryChat = shouldCheckTemporaryChat && isTemporaryChat(platform);
    const temporaryConversationId = temporaryChat
      ? getTemporaryConversationId(platform)
      : null;
    if (
      url !== lastUrl ||
      temporaryChat !== lastTemporaryChat ||
      temporaryConversationId !== lastTemporaryConversationId
    ) {
      lastUrl = url;
      lastTemporaryChat = temporaryChat;
      lastTemporaryConversationId = temporaryConversationId;
      updateUIState();
    }
  }, 800);

  // The content script starts before the page DOM so the network interceptor can attach early.
  // Defer only the initial UI check until the body is available.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateUIState, { once: true });
  } else {
    updateUIState();
  }
})();
