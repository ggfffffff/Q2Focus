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
