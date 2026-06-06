# ChatGPT Markdown Exporter Pro 🚀

A lightweight Chrome/Edge Extension to instantly export complete ChatGPT conversations to Markdown or Raw JSON **without scrolling**.

## 🔴 Why other extensions fail on long chats
Most ChatGPT exporters scrape the webpage's DOM. However, ChatGPT implements **DOM Virtualization (Windowing)**. For long chats, React dynamically unmounts messages that scroll out of the viewport. As a result, scrolling down to the bottom leaves the middle/top sections missing from the DOM, causing truncated exports.

## 🟢 How this extension solves it
This extension bypasses the DOM entirely. It **intercepts ChatGPT's internal backend API responses** which contain the *entire* conversation tree, formatting, and metadata with 100% integrity. 

- **Instant Export**: No scrolling, no waiting. Click and download immediately.
- **100% Integrity**: Never truncates or skips messages.
- **Rich Formatting**: Handles nested conversation branches (always exports the active branch), code interpreter outputs (formatted inside `<details>` blocks), LaTeX equations, and generated images.
- **Citation Resolving**: Automatically parses ChatGPT search citations into clickable Markdown links (e.g. `[Source Title+1](url)`) and cleans leftover unicode citation markers.
- **Privacy & Security**: 100% local. Runs entirely in your browser. No data ever leaves your machine.

---

## 🛠️ Installation

1. Clone or download this repository.
2. Open Google Chrome (or Microsoft Edge) and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the folder containing these files.

---

## 📖 How to Use

1. Navigate to [ChatGPT](https://chatgpt.com/) and log in.
2. Open any conversation.
3. You will see a sleek **Download Cloud Button** in the bottom-right corner of the page.
4. Click the button to toggle the menu and select your export option:
   - **Export Markdown (.md)**: Downloads the clean Markdown format of your chat history.
   - **Export Raw JSON (.json)**: Downloads the raw API payload.
   - **Copy Markdown**: Copies the Markdown directly to your clipboard.

---

## 📂 File Structure

* `manifest.json`: Configuration and script declaration (runs `inject.js` in the `MAIN` world, `content.js` and `styles.css` in the `ISOLATED` world).
* `inject.js`: Injected into the page context. Patches `window.fetch` to intercept/cache conversation responses and capture authorization headers.
* `content.js`: Injected into the extension context. Handles the UI overlay, user interactions, tree traversal (from leaf node to root), and file generations.
* `styles.css`: CSS code for the floating button and glassmorphic popup card.
