(function() {
  let container = null;
  let fab = null;
  let menu = null;
  let statusDot = null;
  let statusText = null;

  let pendingResolver = null;
  let pendingRejecter = null;

  // Helper utility for asynchronous delays
  const delay = ms => new Promise(res => setTimeout(res, ms));

  // Security: Handle postMessage replies with strict origin checks
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message && message.type === 'OAI_EXPORT_RESPONSE') {
      if (message.success) {
        if (pendingResolver) pendingResolver(message.data);
      } else {
        if (pendingRejecter) pendingRejecter(new Error(message.error));
      }
      pendingResolver = null;
      pendingRejecter = null;
    }
  });

  // Request the conversation data from inject.js running in MAIN world
  function requestConversationData(conversationId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingResolver = null;
        pendingRejecter = null;
        reject(new Error('Request timed out. Please refresh the ChatGPT page and try again.'));
      }, 8000);

      pendingResolver = (data) => {
        clearTimeout(timeoutId);
        resolve(data);
      };
      pendingRejecter = (err) => {
        clearTimeout(timeoutId);
        reject(err);
      };
      window.postMessage({ type: 'OAI_EXPORT_REQUEST', conversationId }, window.location.origin);
    });
  }

  // Get active conversation ID from the URL pathname
  function getActiveConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
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
      if (part.content_type === 'image') {
        return `![Generated Image](${part.url || ''})\n\n*Prompt: ${part.prompt || ''}*`;
      }
      if (part.name) {
        return `[Attachment: ${part.name}]`;
      }
      if (part.content_type === 'citation') {
        return `[Citation: ${part.text || 'Reference'}]`;
      }
      // General metadata placeholder instead of dumping JSON.stringify
      return `[Media Content: ${part.content_type || 'Metadata object'}]`;
    }
    return '';
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
    
    const result = {
      conversationId: conversationId,
      title: data.title || 'ChatGPT Conversation',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      source: 'network',
      messages: [],
      raw: data,
      integrity: {
        status: 'complete',
        warnings: []
      }
    };

    if (!mapping || !currentNodeId) {
      result.integrity.status = 'incomplete';
      result.integrity.warnings.push('Missing mapping or current_node in the payload.');
      return result;
    }

    // Traverse the conversation tree backwards from current leaf node to root
    const nodes = [];
    let nodeId = currentNodeId;
    while (nodeId) {
      const node = mapping[nodeId];
      if (node) {
        nodes.push(node);
      }
      nodeId = node ? node.parent : null;
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

      // Extract text content
      let text = '';
      if (message.content && message.content.parts) {
        text = message.content.parts.map(part => parseContentPart(part)).join('\n');
      }

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

      const isCode = message.recipient === 'python' || (message.content && message.content.content_type === 'code');
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
      // 1. Check sequence anomalies (consecutive identical roles)
      let lastRole = '';
      for (let i = 0; i < messages.length; i++) {
        const currentRole = messages[i].role;
        if (currentRole === lastRole && (currentRole === 'user' || currentRole === 'assistant')) {
          result.integrity.status = 'probably-complete';
          result.integrity.warnings.push(`Sequence anomaly: Consecutive messages from same role "${currentRole}" at index ${i}.`);
        }
        lastRole = currentRole;
      }

      // 2. Check if first message is from User
      if (messages[0].role !== 'user') {
        result.integrity.status = 'probably-complete';
        result.integrity.warnings.push('Sequence anomaly: Conversation does not start with a User message.');
      }

      // 3. Check if last message leaves user hanging
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        result.integrity.status = 'probably-complete';
        result.integrity.warnings.push('Sequence anomaly: Conversation ends with a User message (missing final response).');
      }
    }

    return result;
  }

  // Format the normalized message model into a clean, presentation-ready Markdown string (Matching standard ChatGPT export style)
  function convertNormalizedToMarkdown(model) {
    let markdown = '';
    let lastAuthor = null;

    for (const msg of model.messages) {
      const role = msg.role;
      const contentItem = msg.content[0] || { text: '', type: 'markdown' };
      const text = contentItem.text.trim();

      // Skip empty messages, system messages, or internal tool outputs (like web search or interpreter outputs)
      if (!text || role === 'tool' || role === 'system') continue;

      const authorLabel = role === 'user' ? '**You:**' : '**ChatGPT:**';

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

  let isExporting = false;

  // Core handler for exporting
  async function performExport(format, action = 'download') {
    if (isExporting) return;
    
    const conversationId = getActiveConversationId();
    if (!conversationId) {
      setStatus('error', 'No conversation ID');
      return;
    }

    isExporting = true;
    setStatus('loading', 'Loading data...');
    try {
      const rawData = await requestConversationData(conversationId);
      const model = normalizeConversation(rawData);
      
      if (format === 'markdown') {
        const markdown = convertNormalizedToMarkdown(model);
        if (action === 'download') {
          const filename = `${sanitizeFilename(model.title)}_${new Date().toISOString().slice(0, 10)}.md`;
          triggerDownload(markdown, filename, 'text/markdown;charset=utf-8');
          setStatus('ready', `Exported MD! (${model.integrity.status})`);
        } else if (action === 'copy') {
          await navigator.clipboard.writeText(markdown);
          setStatus('ready', 'Copied to clipboard!');
        }
      } else if (format === 'json') {
        const filename = `${sanitizeFilename(model.title)}_${new Date().toISOString().slice(0, 10)}.json`;
        triggerDownload(JSON.stringify(model, null, 2), filename, 'application/json;charset=utf-8');
        setStatus('ready', `Exported JSON! (${model.integrity.status})`);
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
        <div class="oai-exporter-header">Export Options (API)</div>
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
        menu.classList.remove('show');
        fab.classList.remove('open');
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
    const conversationId = getActiveConversationId();
    if (conversationId) {
      if (!container) {
        initUI();
      }
      if (container) {
        container.style.display = 'block';
      }
    } else {
      if (container) {
        container.style.display = 'none';
        menu.classList.remove('show');
        fab.classList.remove('open');
      }
    }
  }

  // Performance-friendly URL polling replacing heavy MutationObserver (Issue 6)
  let lastUrl = location.href;
  setInterval(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      updateUIState();
    }
  }, 800);

  // Initial check on load
  updateUIState();
})();
