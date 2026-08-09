# ChatGPT, Claude, Gemini & Perplexity Markdown Exporter Pro 🚀

A lightweight, premium Chrome/Edge Extension to export conversations from **ChatGPT.com**, **Claude.ai**, **Gemini.google.com**, and **Perplexity.ai** to Markdown or Raw JSON.

## 🔴 Why other extensions fail on long chats
Most AI exporters scrape the webpage's DOM or simulate scrolling. However, these platforms implement **DOM Virtualization (Windowing)**. For long chats, the web frameworks dynamically unmount messages that scroll out of the viewport. As a result, scraping leaves the middle/top sections missing from the DOM, causing truncated exports, while simulated scrolling is slow and frustrating.

## 🟢 How this extension solves it
For ChatGPT, Claude, and Gemini, this extension bypasses the visible DOM and queries internal conversation payloads directly using the page's authenticated context. For Perplexity, it uses layered extraction because Perplexity's private web payloads change more frequently.

- **Instant Export**: No scrolling, no waiting. Click and download immediately.
- **High Integrity**: Prefers complete internal payloads and clearly marks fallback exports with integrity warnings.
- **Multi-Platform Support**:
  - **ChatGPT**: Intercepts ChatGPT's internal backend API responses containing the complete conversation tree.
  - **Claude.ai**: Queries Claude's organization-scoped conversation API.
  - **Gemini**: Direct query to Gemini's internal `batchexecute` RPC endpoint (`hNvQHb`) from the page context, retrieving up to 1000 messages in a single fast request.
  - **Perplexity**: Uses layered extraction for changing Perplexity routes and APIs: cached internal JSON first, hydration data second, and visible thread DOM as a final fallback.
- **Gemini Thoughts (Reasoning)**: Captures Gemini 2.5 Pro's model reasoning processes ("Thoughts") and formats them inside a collapsible details block (`<details><summary>Thinking Process</summary>...</details>`).
- **Optional Citation Links**: Keep source links for research exports, or turn them off for a cleaner reading copy.
- **Assistant Replies Only**: Export only assistant responses when you want a compact answer archive.
- **Clean Metadata**: Archive metadata stays available, while `Integrity Status` is shown only when it is not `complete`.
- **Readable Media Placeholders**: Replaces internal asset pointer strings with clean placeholders like `[Image attached]`.
- **Dynamic Author Labeling**: Dynamically maps chat turns to the correct platform name (e.g., `**Claude:**`, `**Gemini:**`, `**ChatGPT:**`).
- **Hardened Security**: Communication between worlds is secured using a dynamically generated cryptographic session token, preventing third-party script eavesdropping or CSRF spoofing. Validates conversation IDs to prevent path traversal.
- **Rich Formatting**: Handles code interpreter outputs, LaTeX equations, attachments, and generated images.
- **Privacy**: 100% local. Runs entirely in your browser. No data ever leaves your machine.

---

## 🛠️ Installation

1. Clone or download this repository.
2. Open Google Chrome (or Microsoft Edge) and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the folder containing these files.

---

## 📖 How to Use

1. Navigate to [ChatGPT](https://chatgpt.com/), [Claude](https://claude.ai/), [Gemini](https://gemini.google.com/), or [Perplexity](https://www.perplexity.ai/).
2. Open any conversation.
3. You will see a sleek **Download Cloud Button** in the bottom-right corner of the page.
4. Click the button to toggle the menu and select your export option:
   - **Export Markdown (.md)**: Downloads the clean Markdown format of your chat history.
   - **Export Raw JSON (.json)**: Downloads the structured normalized JSON payload.
   - **Copy Markdown**: Copies the Markdown directly to your clipboard.
5. Optional: adjust up to three lightweight export options:
   - **Include Thinking Process**: include Gemini/Claude reasoning blocks when available.
   - **Include Citation Links**: keep inline source/citation links.
   - **Assistant Replies Only**: omit user turns for a compact answer-only export.

---

## 📂 File Structure

* `manifest.json`: Configuration and script declaration. Exposes `inject.js` as a web accessible resource and injects `content.js` at `document_start`.
* `inject.js`: Injected dynamically in the `MAIN` world. Hooks `window.fetch` and handles internal API, `batchexecute` RPC fetches for Claude/Gemini, and Perplexity layered extraction.
* `content.js`: Runs in the `ISOLATED` world. Dynamically injects `inject.js` with a unique shared token, handles the UI overlay, normalizes platform payloads, and generates files.
* `styles.css`: CSS code for the floating button and glassmorphic popup card.

