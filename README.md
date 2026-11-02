# Q2Focus Chrome extension

Q2Focus is a Manifest V3 Chrome extension that turns ChatLLM waiting time into task-linked reflection. It opens as a full browser workspace with ChatLLM on the left and Q2Focus on the right.

The repository contains no API key. Local mode works immediately with the complete scripted interaction. API mode is ready for an OpenAI-compatible chat-completions endpoint; credentials are entered later in the extension settings and stored only in `chrome.storage.local`.

## Install locally in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this `code` folder—the folder containing `manifest.json`.
5. Pin **Q2Focus** from Chrome’s Extensions menu.
6. Click the Q2Focus toolbar icon to open the workspace.

After editing the source, return to `chrome://extensions` and click the reload icon on the Q2Focus card, then refresh any open Q2Focus tab.

## Use the local flow

1. Send any prompt. For the prepared walkthrough, use:

   > Design a one-week healthy plan for me

2. Q2Focus questions appear while ChatLLM is thinking.
3. Complete four questions. Three seconds later, the ChatLLM response appears.
4. Use **Regenerate** to rebuild the answer from the reflections, or **Fill as context** to attach editable context to the next prompt.
5. Send the follow-up prompt to enter a new Q2Focus round.

All selection questions include **Other**, with a custom text field.

## Connect an API later

1. Open Q2Focus and click **Settings**.
2. Change **Response source** to **OpenAI-compatible API**.
3. Enter the chat-completions endpoint, model name, and your own API key.
4. Save, then refresh the Q2Focus workspace.

The default endpoint placeholder is:

```text
https://api.openai.com/v1/chat/completions
```

No key is present in this repository. Never add a key to `app.js`, `options.js`, screenshots, commits, or GitHub Actions. If a key is ever committed, revoke it with the provider immediately and remove it from Git history.

## Put the project on GitHub

First, create an empty repository on GitHub named `q2focus` without adding a README or `.gitignore`. Then run:

```bash
cd /Users/goufangfei/Desktop/UIST/code
git init
git add .
git commit -m "Create Q2Focus Chrome extension"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/q2focus.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username. For later updates:

```bash
git add .
git commit -m "Update Q2Focus"
git push
```

## Package and distribute

GitHub visitors can inspect or download the source, but Chrome does not install unpacked extensions directly from a GitHub link. For a public one-click installation link, publish a ZIP through the Chrome Web Store.

From inside this folder, create the upload package with:

```bash
zip -r q2focus-extension.zip . -x ".git/*" ".DS_Store" "*.zip"
```

Upload `q2focus-extension.zip` in the Chrome Web Store Developer Dashboard. After review, the store listing URL is the best destination for a QR code.

## Generate a QR code

For a quick GitHub QR code:

1. Open `https://github.com/YOUR_USERNAME/q2focus` in Chrome.
2. Use Chrome’s Share menu and choose **Create QR code**.
3. Download the PNG.

For an install QR code, repeat those steps using the final Chrome Web Store listing URL. A QR code that points only to GitHub opens the source repository; it does not install the extension automatically.

You can also generate a PNG from the command line:

```bash
npx qrcode -o q2focus-qr.png "https://github.com/YOUR_USERNAME/q2focus"
```

## Project files

- `manifest.json` — Chrome Manifest V3 declaration
- `background.js` — opens the Q2Focus workspace from the toolbar
- `index.html`, `styles.css`, `app.js` — main ChatLLM + Q2Focus experience
- `options.html`, `options.css`, `options.js` — local/API settings page
- `icons/icon.svg` — editable source artwork for future store icons
- `.gitignore` — excludes local secrets, ZIP packages, and temporary files
