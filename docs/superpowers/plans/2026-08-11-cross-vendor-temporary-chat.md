# Cross-vendor temporary chat support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Mount the exporter reliably on Claude Incognito, Gemini Temporary Chat, and Perplexity Incognito/Temporary Thread pages while preserving normal conversation behavior.

**Architecture:** Keep detection in `content.js`. Each platform keeps its existing route parser first, then uses platform-specific private-mode hints and DOM attributes as fallbacks. The existing `inject.js` platform fetchers remain unchanged unless a regression test proves an ID-format boundary is incompatible.

**Tech Stack:** Chrome Manifest V3 content script, plain JavaScript, Node `node:test` lifecycle tests.

---

### Task 1: Extend the lifecycle fixture and add failing tests

**Files:**
- Modify: `tests/content-ui-lifecycle.test.js`

- [ ] **Step 1: Add platform constants and fixture controls**

Extend the existing `loadContentScript` fixture with a hostname, query string,
private-mode marker, and delayed DOM conversation ID. Keep the current ChatGPT
tests unchanged and expose `setTemporaryConversationId` plus `poll` for the new
cases.

- [ ] **Step 2: Add failing tests for Claude, Gemini, and Perplexity**

Add one direct-mount test and one delayed-ID test per platform. Use these route
and marker fixtures:

```js
loadContentScript('/new?incognito', {
  hostname: 'claude.ai',
  temporaryMode: 'Incognito chat',
  temporaryConversationId: CLAUDE_ID
});
loadContentScript('/app?temporary-chat=true', {
  hostname: 'gemini.google.com',
  temporaryMode: 'Temporary chat',
  temporaryConversationId: GEMINI_ID
});
loadContentScript('/?incognito=true', {
  hostname: 'www.perplexity.ai',
  temporaryMode: 'Incognito',
  temporaryConversationId: PERPLEXITY_ID
});
```

Also add ordinary home-page cases containing no private-mode marker and assert
that `appendCount` remains zero.

- [ ] **Step 3: Run the lifecycle suite and verify the new tests fail for the missing behavior**

Run:

```powershell
node --test tests/content-ui-lifecycle.test.js
```

Expected: the existing ChatGPT tests pass, while the new vendor tests fail with
`appendCount` equal to `0`.

### Task 2: Implement platform-specific private-chat detection

**Files:**
- Modify: `content.js:85-180`
- Modify: `content.js:1000-1020`

- [ ] **Step 1: Add helpers for private-mode hints and DOM IDs**

Implement `isTemporaryChat(platform)` using query flags (`temporary-chat=true`,
`incognito`, and `incognito=true`) plus explicit platform indicator attributes
or text. Implement `getTemporaryConversationId(platform)` by reading stable
`data-conversation-id`, `data-chat-id`, `data-thread-id`, and accessibility
labels. Keep ID parsing platform-aware: UUID-like IDs for Claude/ChatGPT,
Gemini route IDs through the existing Gemini ID pattern, and Perplexity IDs
through its existing permissive pattern.

- [ ] **Step 2: Use private DOM IDs only after the platform route parser**

Update `getActiveConversationId()` so Claude, Gemini, and Perplexity retain
their current route IDs and only fall back to a private DOM ID when that
platform is visibly in private mode. Ordinary `/`, `/new`, and `/app` pages
must still return `null`.

- [ ] **Step 3: Retry only when private state or its ID changes**

Track the last URL and last private conversation ID per current page. Extend
the existing 800ms polling condition so delayed private DOM IDs trigger
`updateUIState()` without reintroducing a global MutationObserver or polling
all normal pages.

- [ ] **Step 4: Run the lifecycle suite and verify all tests pass**

Run the same Node test command. Expected: all existing and new tests pass with
zero failures.

### Task 3: Validate the complete extension and simplify the diff

**Files:**
- Review: `content.js`, `tests/content-ui-lifecycle.test.js`, `manifest.json`

- [ ] **Step 1: Run syntax checks and manifest resource validation**

Run:

```powershell
node --check content.js
node --check inject.js
node --check tests/content-ui-lifecycle.test.js
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("manifest.json","utf8"));const files=["content.js","inject.js","styles.css",...(m.icons?Object.values(m.icons):[])];const missing=files.filter(f=>!fs.existsSync(f));if(missing.length){console.error(missing);process.exit(1)};console.log("manifest and resources valid")'
```

- [ ] **Step 2: Inspect the diff and whitespace**

Run:

```powershell
git diff --check
git diff --stat
git status --short
```

Confirm that only the intended source, test, and plan/spec files changed; do
not stage `.playwright-cli/` or unrelated user files.

- [ ] **Step 3: Run the final lifecycle suite after the diff review**

Run `node --test tests/content-ui-lifecycle.test.js` again and record the final
pass count before reporting completion.
