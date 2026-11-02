const DEFAULTS = {
  mode: "local",
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  apiKey: ""
};

const mode = document.querySelector("#mode");
const endpoint = document.querySelector("#endpoint");
const model = document.querySelector("#model");
const apiKey = document.querySelector("#apiKey");
const apiFields = document.querySelector("#apiFields");
const status = document.querySelector("#settingsStatus");

function updateMode() {
  apiFields.classList.toggle("disabled", mode.value !== "api");
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function originPattern(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/*`;
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(DEFAULTS);
  mode.value = saved.mode;
  endpoint.value = saved.endpoint;
  model.value = saved.model;
  apiKey.value = saved.apiKey;
  updateMode();
}

async function saveSettings() {
  showStatus("");
  const next = {
    mode: mode.value,
    endpoint: endpoint.value.trim(),
    model: model.value.trim(),
    apiKey: apiKey.value.trim()
  };

  if (next.mode === "api") {
    if (!next.endpoint || !next.model) {
      showStatus("Endpoint and model are required for API mode.", true);
      return;
    }
    if (!next.apiKey) {
      showStatus("Add an API key or switch back to local mode.", true);
      return;
    }
    try {
      const pattern = originPattern(next.endpoint);
      if (pattern !== "https://api.openai.com/*") {
        const granted = await chrome.permissions.request({ origins: [pattern] });
        if (!granted) {
          showStatus("Chrome did not grant access to this API endpoint.", true);
          return;
        }
      }
    } catch {
      showStatus("Enter a valid endpoint URL.", true);
      return;
    }
  }

  await chrome.storage.local.set(next);
  showStatus("Settings saved. Reopen or refresh the Q2Focus workspace.");
}

mode.addEventListener("change", updateMode);
document.querySelector("#toggleKey").addEventListener("click", (event) => {
  const show = apiKey.type === "password";
  apiKey.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "Hide" : "Show";
});
document.querySelector("#clearKey").addEventListener("click", async () => {
  apiKey.value = "";
  await chrome.storage.local.set({ apiKey: "", mode: "local" });
  mode.value = "local";
  updateMode();
  showStatus("Saved API key cleared. Local mode is active.");
});
document.querySelector("#saveSettings").addEventListener("click", saveSettings);

loadSettings().catch(() => showStatus("Could not load extension settings.", true));
