(function() {
  const conversationCache = {};
  let capturedToken = null;

  // Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
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

    // 2. Intercept and cache conversation JSON responses (GET requests only, with exact path)
    const requestMethod = (options.method || 'GET').toUpperCase();
    if (requestMethod === 'GET' && typeof requestUrl === 'string' && requestUrl.includes('/backend-api/conversation/')) {
      try {
        // Split at '?' to remove query parameters and match only exact conversation ID url
        const cleanUrl = requestUrl.split('?')[0];
        const match = cleanUrl.match(/\/backend-api\/conversation\/([a-f0-9-]+)$/);
        if (match) {
          const conversationId = match[1];
          const clonedResponse = response.clone();
          clonedResponse.json().then(data => {
            // Only cache if the response contains valid mapping data to avoid caching errors or metadata updates
            if (data && data.mapping && data.current_node) {
              conversationCache[conversationId] = data;
            }
          }).catch(err => {
            // Ignore parse errors on partial responses (e.g. streaming chunks)
          });
        }
      } catch (e) {
        console.error('[Exporter Inject] Error processing conversation fetch:', e);
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

  // Helper function to fetch the conversation data using the token
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
      // If unauthorized, token might have expired. Try to refresh token once.
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

  // Listen for messages from content.js with strict origin validation
  window.addEventListener('message', async (event) => {
    // Security: Only accept messages from our own window and matching domain origin
    if (event.source !== window || event.origin !== window.location.origin) return;
    
    const message = event.data;
    if (message && message.type === 'OAI_EXPORT_REQUEST') {
      const conversationId = message.conversationId;
      try {
        let data = conversationCache[conversationId];
        // If data is missing or doesn't have mapping/current_node, bypass cache and fetch fresh
        if (!data || !data.mapping || !data.current_node) {
          data = await fetchConversation(conversationId);
        }
        window.postMessage({
          type: 'OAI_EXPORT_RESPONSE',
          conversationId,
          success: true,
          data
        }, window.location.origin); // Security: Restrict targetOrigin to current origin
      } catch (err) {
        window.postMessage({
          type: 'OAI_EXPORT_RESPONSE',
          conversationId,
          success: false,
          error: err.message
        }, window.location.origin);
      }
    }
  });

  console.log('[Exporter Inject] Successfully initialized secure window.fetch hooks.');
})();
