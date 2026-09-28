# Cross-vendor temporary chat export design

## Goal

Show the exporter on temporary or private conversations for ChatGPT, Claude,
Gemini, and Perplexity without changing the existing normal-conversation export
paths.

## Scope and behavior

- ChatGPT keeps its `temporary-chat=true` route detection and `chat-<UUID>` DOM
  lookup.
- Claude recognizes Incognito chat state and continues to prefer the existing
  `/chat/<conversation-id>` route.
- Gemini recognizes Temporary chat state and continues to prefer its existing
  `/app/<chat-id>` and `/gem/<gem-id>/<chat-id>` routes.
- Perplexity recognizes Incognito/Temporary thread state and continues to prefer
  its existing `/search/<thread-id>` and `/page/<thread-id>` routes.
- When a private page has no route ID yet, the content script may obtain a
  platform-specific DOM ID and retry only while that private state is active.
- Ordinary home/new-chat pages remain hidden and must not be activated by help
  text or unrelated DOM labels.

## Implementation boundary

`content.js` owns platform and temporary-state detection because it controls
whether the UI is mounted. Existing `inject.js` fetchers remain the data
boundary; they receive the same platform-specific conversation ID as normal
exports. No new persistent state, permissions, or production dependency is
needed.

Detection uses explicit URL hints where a platform exposes them and stable
accessibility/data attributes or visible mode indicators where the mode is
client-side only. Existing route parsers have precedence over DOM fallbacks.

## Verification

Add lifecycle tests for each vendor covering:

1. a private page whose ID is already present;
2. a private page whose ID appears after DOM readiness;
3. a normal home/new-chat page that contains no private-mode signal.

Run the lifecycle suite, JavaScript syntax checks, manifest resource validation,
and `git diff --check` before completion.
