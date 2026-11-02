const FOLLOW_UP_PROMPT = "Turn this into a shopping list and a Sunday meal-prep plan.";
const DEFAULT_SETTINGS = {
  mode: "local",
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  apiKey: ""
};

const firstRoundQuestions = [
  {
    id: "goal",
    role: "Clarification",
    format: "Multiple choice",
    prompt: "Which outcomes matter most for this plan?",
    helper: "Select up to 2",
    multi: true,
    max: 2,
    options: ["Fat loss", "Muscle support", "Better energy", "Simpler routine"]
  },
  {
    id: "rhythm",
    role: "Clarification",
    format: "Single choice",
    prompt: "Which daily rhythm feels realistic?",
    options: ["3 meals", "3 meals + 1 snack", "3 meals + 2 snacks", "5 smaller meals"]
  },
  {
    id: "restriction",
    role: "Clarification",
    format: "True / false",
    prompt: "Avoid processed foods and sugary drinks?",
    options: ["Yes", "No"]
  },
  {
    id: "cuisine",
    role: "Exploration",
    format: "Multiple choice",
    prompt: "Which flavor directions would keep the week engaging?",
    helper: "Select up to 2",
    multi: true,
    max: 2,
    options: ["Asian-inspired", "Mediterranean", "Latin-inspired", "Mostly plant-based"]
  },
  {
    id: "action",
    role: "Reflection",
    format: "Short answer",
    prompt: "After receiving the plan, my first action will be…",
    placeholder: "e.g. prep lunches on Sunday"
  }
];

const secondRoundQuestions = [
  {
    id: "prepPriority",
    role: "Clarification",
    format: "Multiple choice",
    prompt: "What should the Sunday prep plan optimize for?",
    helper: "Select up to 2",
    multi: true,
    max: 2,
    options: ["Finish under 90 minutes", "Minimal cleanup", "Maximum freshness", "More weekday variety"]
  },
  {
    id: "coverage",
    role: "Clarification",
    format: "Single choice",
    prompt: "How many days should one prep session cover?",
    options: ["3 days", "4 days", "5 days", "The full week"]
  },
  {
    id: "shopping",
    role: "Exploration",
    format: "Multiple choice",
    prompt: "Which shopping constraints should shape the list?",
    helper: "Select up to 2",
    multi: true,
    max: 2,
    options: ["One grocery trip", "Budget-aware", "Freezer-friendly", "Minimal ingredients"]
  },
  {
    id: "pantry",
    role: "Reflection",
    format: "Short answer",
    prompt: "One ingredient I already have and want to use is…",
    placeholder: "e.g. brown rice"
  }
];

const state = {
  phase: "idle",
  answers: {},
  contextAttached: false,
  contextEntries: [],
  hasRegenerated: false,
  round: 0,
  currentQuestions: firstRoundQuestions,
  timers: [],
  thinkingNode: null,
  thinkingInterval: null,
  firstRevealTimer: null,
  settings: { ...DEFAULT_SETTINGS },
  initialPrompt: "",
  activePrompt: "",
  pendingResponse: null,
  lastApiError: ""
};

const $ = (selector) => document.querySelector(selector);
const conversation = $("#conversation");
const focusStage = $("#focusStage");
const chatForm = $("#chatForm");
const chatInput = $("#chatInput");
const sendButton = $("#sendButton");
const focusState = $("#focusState");
const focusOrb = $("#focusOrb");
const reuseBar = $("#reuseBar");
const contextPreview = $("#contextPreview");
const contextFields = $("#contextFields");

function schedule(fn, delay) {
  const timer = window.setTimeout(fn, delay);
  state.timers.push(timer);
  return timer;
}

function clearTimers() {
  state.timers.forEach(window.clearTimeout);
  state.timers = [];
  state.firstRevealTimer = null;
  if (state.thinkingInterval) window.clearInterval(state.thinkingInterval);
  state.thinkingInterval = null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function modelContentToHtml(value) {
  const safe = escapeHtml(value || "").trim();
  if (!safe) return "";
  return safe
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*] /.test(line))) {
        return `<ul>${lines.map((line) => `<li>${line.slice(2)}</li>`).join("")}</ul>`;
      }
      if (/^<h[23]>/.test(block)) return block;
      return `<p>${block.replaceAll("\n", "<br />")}</p>`;
    })
    .join("");
}

function answerSummary(answers = state.answers) {
  return Object.entries(answers)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
}

function contextSummary() {
  return state.contextEntries
    .map((entry) => `${entry.label}: ${entry.value}`)
    .join("\n");
}

function updateConnectionUI() {
  const configured = state.settings.mode === "api" && Boolean(state.settings.apiKey);
  $("#modelLabel").textContent = configured ? state.settings.model : "Local model";
  $("#connectionStatus").textContent = configured
    ? `API connected · ${state.settings.model}`
    : "Local responses · no API data is sent";
  $("#connectionDot").classList.toggle("connected", configured);
  $("#modelChip").classList.toggle("connected", configured);
}

async function loadRuntimeSettings() {
  if (!globalThis.chrome?.storage?.local) {
    updateConnectionUI();
    return;
  }
  const saved = await chrome.storage.local.get(DEFAULT_SETTINGS);
  state.settings = { ...DEFAULT_SETTINGS, ...saved };
  updateConnectionUI();
}

async function requestModel(messages) {
  const { mode, endpoint, model, apiKey } = state.settings;
  if (mode !== "api" || !apiKey) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API request failed (${response.status}): ${detail.slice(0, 180)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The API returned an empty or unsupported response.");
  }
  return content.trim();
}

function startModelRequest(userPrompt, extraContext = "") {
  const system = `You are ChatLLM inside Q2Focus. Give a useful, structured, concrete answer. Use headings and concise paragraphs. Q2Focus reflections are user-provided preferences; incorporate them when present. ${extraContext}`;
  state.lastApiError = "";
  return requestModel([
    { role: "system", content: system },
    { role: "user", content: userPrompt }
  ]).catch((error) => {
    state.lastApiError = error.message;
    return null;
  });
}

function scrollConversation() {
  schedule(() => { conversation.scrollTop = conversation.scrollHeight; }, 30);
}

function autoResizeInput() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

function addUserMessage(text) {
  const node = document.createElement("div");
  node.className = "message user";
  node.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
  conversation.appendChild(node);
  scrollConversation();
}

function addAssistantMessage(html, label = "response") {
  const node = document.createElement("div");
  node.className = "message assistant";
  node.innerHTML = `
    <div class="avatar ai-avatar" aria-hidden="true"><span></span></div>
    <div class="message-body">
      <div class="message-meta"><strong>ChatLLM</strong><span>${label}</span></div>
      <div class="message-copy">${html}</div>
    </div>`;
  conversation.appendChild(node);
  scrollConversation();
  return node;
}

function addThinking(details = ["Understanding your goal…", "Balancing nutrition and practicality…", "Drafting a weekly structure…"]) {
  const fragment = $("#thinkingTemplate").content.cloneNode(true);
  state.thinkingNode = fragment.querySelector(".thinking-message");
  const detail = fragment.querySelector(".thinking-detail");
  conversation.appendChild(fragment);
  let index = 0;
  state.thinkingInterval = window.setInterval(() => {
    index = (index + 1) % details.length;
    detail.textContent = details[index];
  }, 1800);
  scrollConversation();
}

function removeThinking() {
  if (state.thinkingInterval) window.clearInterval(state.thinkingInterval);
  state.thinkingInterval = null;
  state.thinkingNode?.remove();
  state.thinkingNode = null;
}

function setFocusStatus(mode, text) {
  focusState.className = `focus-state ${mode}`;
  focusState.innerHTML = `<span></span>${text}`;
  focusOrb.classList.toggle("active", mode === "active");
}

function updateGuide(step) {
  document.querySelectorAll("#walkthroughSteps li").forEach((item) => {
    const itemStep = Number(item.dataset.step);
    item.classList.toggle("active", itemStep === step);
    item.classList.toggle("done", itemStep < step);
  });
  const cta = $("#guideCta");
  const labels = {
    1: "Focus message box",
    2: "Return to the questions",
    3: "Complete the reflections",
    4: "Return to reuse controls"
  };
  cta.textContent = labels[step] || "Return to workspace";
}

function roleClass(role) {
  return `role-${role.toLowerCase()}`;
}

function buildQuestionCard(question, index) {
  const card = document.createElement("article");
  card.className = "question-card";
  card.dataset.questionId = question.id;
  card.style.animationDelay = `${index * 55}ms`;
  let controls = "";
  if (question.options) {
    const inputType = question.multi ? "checkbox" : "radio";
    const options = [...question.options, "Other"];
    controls = `<div class="option-grid">${options.map((option, optionIndex) => `
      <div class="option">
        <input type="${inputType}" id="${question.id}-${optionIndex}" name="${question.id}" value="${option === "Other" ? "__other__" : escapeHtml(option)}" ${option === "Other" ? 'data-other-option="true"' : ""} />
        <label for="${question.id}-${optionIndex}">${escapeHtml(option)}</label>
      </div>`).join("")}</div>
      <div class="other-answer-wrap" hidden>
        <label for="${question.id}-other-text">Your answer</label>
        <input class="other-answer" type="text" id="${question.id}-other-text" placeholder="Type your own option…" autocomplete="off" />
      </div>`;
  } else {
    controls = `<input class="short-answer" type="text" id="${question.id}" name="${question.id}" placeholder="${escapeHtml(question.placeholder)}" />`;
  }
  card.innerHTML = `
    <div class="question-kicker">
      <span class="question-role ${roleClass(question.role)}">${question.role}</span>
      <span class="question-format">${question.format}</span>
    </div>
    <h3>${question.prompt}</h3>
    ${question.helper ? `<p class="question-helper">${question.helper}</p>` : ""}
    ${controls}`;
  card.addEventListener("change", handleQuestionChange);
  const shortAnswer = card.querySelector(".short-answer");
  if (shortAnswer) {
    shortAnswer.addEventListener("input", handleQuestionChange);
    shortAnswer.addEventListener("blur", handleQuestionChange);
  }
  const otherAnswer = card.querySelector(".other-answer");
  if (otherAnswer) {
    otherAnswer.addEventListener("input", handleQuestionChange);
    otherAnswer.addEventListener("blur", handleQuestionChange);
  }
  return card;
}

function startFocusQuestions(questionSet, copy = {}) {
  state.currentQuestions = questionSet;
  setFocusStatus("active", "Anchoring attention");
  focusStage.innerHTML = `
    <div class="focus-intro">
      <span class="focus-intro-icon">Q²</span>
      <div><strong>${copy.title || "Stay with the task while ChatLLM thinks."}</strong><p>${copy.description || "Answer any, answer all, or simply read. There are no wrong answers."}</p></div>
    </div>
    <div class="question-list" id="questionList"></div>
    <div class="question-count"><span id="answeredCount">0 of ${questionSet.length} reflected</span><span class="progress-track"><span class="progress-fill" id="progressFill"></span></span></div>`;
  focusStage.scrollTop = 0;
  const list = $("#questionList");
  questionSet.forEach((question, index) => {
    schedule(() => {
      list.appendChild(buildQuestionCard(question, index));
    }, index * 230);
  });
  reuseBar.hidden = false;
  syncReuseButtons();
  updateGuide(state.round === 1 ? 2 : 4);
}

function handleQuestionChange(event) {
  const card = event.target.closest(".question-card");
  const id = card.dataset.questionId;
  let value = "";
  const question = state.currentQuestions.find((item) => item.id === id);
  if (event.target.type === "checkbox") {
    const checked = [...card.querySelectorAll('input[type="checkbox"]:checked')];
    if (question.max && checked.length > question.max) {
      event.target.checked = false;
    }
  }

  if (question.options) {
    const otherOption = card.querySelector("[data-other-option]");
    const otherWrap = card.querySelector(".other-answer-wrap");
    const otherAnswer = card.querySelector(".other-answer");
    const usesOther = Boolean(otherOption?.checked);
    otherWrap.hidden = !usesOther;
    const selectedValues = [...card.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')]
      .map((input) => {
        if (input.value !== "__other__") return input.value;
        const customValue = otherAnswer.value.trim();
        return customValue ? `Other: ${customValue}` : "";
      })
      .filter(Boolean);
    value = question.multi ? selectedValues : (selectedValues[0] || "");
  } else {
    value = event.target.value.trim();
  }
  const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value);
  if (hasValue) state.answers[id] = value;
  else delete state.answers[id];
  card.classList.toggle("answered", hasValue);
  updateQuestionProgress();
}

function syncReuseButtons() {
  const count = Object.keys(state.answers).length;
  const busyPhases = ["thinking", "revealing", "follow-up-thinking", "revealing-follow-up", "regenerating", "second-regenerating", "generic-thinking"];
  const answerReady = !busyPhases.includes(state.phase) && state.phase !== "idle" && count > 0;
  $("#fillContextButton").disabled = !answerReady || state.round === 2;
  $("#regenerateButton").disabled = !answerReady || state.hasRegenerated;
  $("#clearButton").disabled = count === 0;
}

function clearAnswers() {
  state.answers = {};
  focusStage.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
    input.checked = false;
  });
  focusStage.querySelectorAll(".short-answer").forEach((input) => {
    input.value = "";
  });
  focusStage.querySelectorAll(".other-answer").forEach((input) => {
    input.value = "";
  });
  focusStage.querySelectorAll(".other-answer-wrap").forEach((wrap) => {
    wrap.hidden = true;
  });
  focusStage.querySelectorAll(".question-card").forEach((card) => {
    card.classList.remove("answered");
  });
  updateQuestionProgress();
  showCompletionNote("Answers cleared", "The questions are ready for a fresh pass.");
}

function updateQuestionProgress() {
  const count = Object.keys(state.answers).length;
  const answeredCount = $("#answeredCount");
  const progressFill = $("#progressFill");
  const total = state.currentQuestions.length;
  const initialRevealThreshold = Math.min(4, total);
  if (answeredCount) answeredCount.textContent = `${count} of ${total} reflected`;
  if (progressFill) progressFill.style.width = `${(count / total) * 100}%`;
  if (state.phase === "thinking") {
    if (count < initialRevealThreshold && state.firstRevealTimer) {
      window.clearTimeout(state.firstRevealTimer);
      state.firstRevealTimer = null;
    }
    if (count >= initialRevealThreshold && !state.firstRevealTimer) {
      state.firstRevealTimer = schedule(() => {
        state.firstRevealTimer = null;
        if (
          state.phase === "thinking" &&
          Object.keys(state.answers).length >= initialRevealThreshold
        ) {
          revealInitialAnswer();
        }
      }, 3000);
    }
  }
  if (count >= 3 && state.phase === "follow-up-thinking") revealFollowUpAnswer();
  if (count >= initialRevealThreshold && state.round === 1) updateGuide(3);
  syncReuseButtons();
}

function initialResponse() {
  return `
    <p>Here’s a complete starting plan built around high-protein whole foods, steady energy, and ingredients that can be reused across the week. I’m treating “muscle gain and fat loss” as a body-recomposition goal: protein stays consistent, vegetables create volume, and carbohydrate portions flex with training demand.</p>
    <p><strong>Simple portion framework:</strong> at each main meal, aim for 1–2 palms of protein, 1 fist of vegetables, 1 cupped hand of carbohydrates, and 1 thumb of healthy fat. On harder training days, add another half to one cupped hand of carbohydrates around the workout.</p>
    <div class="response-card">
      <div class="response-row"><span class="response-day">Monday</span><span class="response-meals">Overnight oats with berries · chicken grain bowl · salmon, greens & roasted potatoes · Greek yogurt</span></div>
      <div class="response-row"><span class="response-day">Tuesday</span><span class="response-meals">Eggs and whole-grain toast · lentil-feta salad · turkey vegetable stir-fry · apple with nut butter</span></div>
      <div class="response-row"><span class="response-day">Wednesday</span><span class="response-meals">Greek yogurt parfait · leftover chicken bowl · tofu curry with brown rice · roasted edamame</span></div>
      <div class="response-row"><span class="response-day">Thursday</span><span class="response-meals">Protein oats · tuna and white-bean salad · lemon-herb chicken with vegetables · fruit and cottage cheese</span></div>
      <div class="response-row"><span class="response-day">Friday</span><span class="response-meals">Vegetable omelet · hummus chicken wrap · shrimp noodle bowl · a small handful of nuts</span></div>
      <div class="response-row"><span class="response-day">Saturday</span><span class="response-meals">Berry smoothie bowl · flexible leftovers · one relaxed social meal with a protein and vegetable anchor</span></div>
      <div class="response-row"><span class="response-day">Sunday</span><span class="response-meals">Avocado eggs · salmon grain salad · turkey meatballs with tomato sauce · yogurt and berries</span></div>
    </div>
    <p><strong>Weekly structure:</strong> batch-cook one grain, two proteins, and a tray of vegetables; keep two meals flexible for leftovers or social plans. Aim to include a palm-sized protein source and at least one vegetable at lunch and dinner.</p>
    <p><strong>Protein rotation:</strong> chicken, salmon, turkey, tofu, eggs, tuna, Greek yogurt, cottage cheese, lentils, and edamame prevent the week from feeling repetitive while keeping the ingredient list manageable.</p>
    <p><strong>Easy substitutions:</strong> swap chicken for tofu or tempeh, salmon for white fish, rice for quinoa, Greek yogurt for a fortified soy yogurt, and any listed vegetable for a seasonal alternative. The structure matters more than the exact ingredient.</p>
    <p><strong>Hydration and recovery:</strong> use water, sparkling water, tea, or coffee without added sugar as default drinks. Include a protein-rich snack after training when the next full meal is more than two hours away.</p>
    <p>Adjust portions to your energy needs. If training volume is high, add rice, potatoes, oats, or fruit around workouts; on lighter days, keep the same meals and slightly reduce the starch portion. Reassess hunger, energy, and training performance after one week rather than trying to make the first version perfect.</p>`;
}

function tailoredResponse() {
  const goal = Array.isArray(state.answers.goal) ? state.answers.goal.join(" + ") : (state.answers.goal || "body recomposition");
  const rhythm = state.answers.rhythm || "3 meals + 1 snack";
  const cuisine = Array.isArray(state.answers.cuisine) ? state.answers.cuisine.join(" + ") : (state.answers.cuisine || "Asian-inspired + Mediterranean");
  const restriction = state.answers.restriction || "Yes";
  return `
    <p>I’ve rebuilt the plan around your Q2Focus answers: <strong>${escapeHtml(goal)}</strong>, <strong>${escapeHtml(rhythm)}</strong>, and <strong>${escapeHtml(cuisine)}</strong> flavors.</p>
    <p>The plan uses a repeatable breakfast-and-lunch structure while keeping dinners varied. That gives you predictable protein intake without making every day feel identical.</p>
    <div class="response-card">
      <div class="response-row"><span class="response-day">Monday</span><span class="response-meals">Miso egg bowl · sesame chicken soba · salmon, rice & cucumber · Greek yogurt with berries</span></div>
      <div class="response-row"><span class="response-day">Tuesday</span><span class="response-meals">Berry overnight oats · chicken hummus pita · tofu bibimbap · steamed edamame</span></div>
      <div class="response-row"><span class="response-day">Wednesday</span><span class="response-meals">Spinach omelet · tuna grain bowl · lemon-herb chicken · apple with tahini</span></div>
      <div class="response-row"><span class="response-day">Thursday</span><span class="response-meals">Yogurt, oats & walnuts · leftover tofu bowl · miso salmon with broccoli · citrus fruit</span></div>
      <div class="response-row"><span class="response-day">Friday</span><span class="response-meals">Egg and avocado toast · sesame chicken salad · Mediterranean turkey meatballs · cucumber yogurt</span></div>
      <div class="response-row"><span class="response-day">Saturday</span><span class="response-meals">Protein smoothie · flexible leftovers · social dinner using the protein-and-vegetable anchor</span></div>
      <div class="response-row"><span class="response-day">Sunday</span><span class="response-meals">Vegetable frittata · salmon hummus pita · tofu and vegetable curry · Greek yogurt</span></div>
    </div>
    <p><strong>How the plan supports your goals:</strong> every main meal contains a clear protein source; most carbohydrates sit near breakfast, lunch, or training; high-volume vegetables and fruit support fullness; and two flexible meals reduce the risk of an all-or-nothing routine.</p>
    <p><strong>Preparation strategy:</strong> cook chicken, tofu, one grain, and two trays of vegetables on Sunday. Mix a lemon-tahini sauce and a miso-sesame sauce so the same components can move between Mediterranean and Asian-inspired meals.</p>
    <p>${restriction === "Yes" ? "Sugary drinks and highly processed foods are excluded; water, sparkling water, tea, and coffee are the default drinks." : "Flexible treats can fit in moderation without changing the overall structure."} Your first-action note—<strong>${escapeHtml(state.answers.action || "prep lunches on Sunday")}</strong>—is now the prep anchor.</p>
    <p>Use the first week as a calibration period: if workouts feel flat, add a carbohydrate serving; if meals are not filling, increase vegetables and lean protein first. Consistency across several weeks matters more than hitting an exact menu every day.</p>`;
}

function followUpResponse() {
  const context = Object.fromEntries(state.contextEntries.map((entry) => [entry.key, entry.value]));
  const priority = Array.isArray(state.answers.prepPriority) ? state.answers.prepPriority.join(" + ") : (state.answers.prepPriority || "an efficient, low-cleanup session");
  const coverage = state.answers.coverage || "5 days";
  const shopping = Array.isArray(state.answers.shopping) ? state.answers.shopping.join(" + ") : (state.answers.shopping || "one grocery trip + minimal ingredients");
  const pantry = state.answers.pantry || "brown rice";
  return `
    <p>I used your edited Q2Focus context—<strong>${escapeHtml(context.goals || "balanced goals")}</strong>, <strong>${escapeHtml(context.rhythm || "a practical daily structure")}</strong>, and <strong>${escapeHtml(context.flavors || "flexible flavors")}</strong>—plus your latest preferences: <strong>${escapeHtml(priority)}</strong>, coverage for <strong>${escapeHtml(coverage)}</strong>, and <strong>${escapeHtml(shopping)}</strong>.</p>
    <p>The plan below assumes you already have <strong>${escapeHtml(pantry)}</strong>. Quantities are sized for one adult; double the proteins and grains if preparing for two people.</p>
    <p><strong>Produce:</strong> 2 cucumbers, 3 bell peppers, 2 broccoli crowns, 1 bag spinach, 1 bunch scallions, 1 red onion, 3 lemons, 1 head garlic, 5 apples, 1 box berries, and 2 avocados.</p>
    <p><strong>Proteins and dairy:</strong> 1.2 kg chicken thighs, 2 salmon fillets, 400 g firm tofu, 8 eggs, 750 g Greek yogurt, 1 bag frozen edamame, and 2 cans tuna.</p>
    <p><strong>Grains and pantry:</strong> oats, soba noodles, whole-wheat pitas, hummus, tahini, low-sodium soy sauce, miso, sesame oil, olive oil, rice vinegar, nuts, and your existing ${escapeHtml(pantry)}.</p>
    <p><strong>Sunday prep timeline — about 85 minutes:</strong></p>
    <ul>
      <li><strong>0–10 min:</strong> heat the oven, start the grain, press the tofu, and wash all produce.</li>
      <li><strong>10–25 min:</strong> season chicken with lemon and herbs; season tofu with miso and sesame. Put both in the oven on separate lined trays.</li>
      <li><strong>25–40 min:</strong> chop peppers and broccoli, add them to the oven, then boil eggs and cook soba noodles.</li>
      <li><strong>40–55 min:</strong> mix two sauces: lemon-tahini and miso-sesame. Slice cucumbers and prepare spinach for grab-and-go bowls.</li>
      <li><strong>55–70 min:</strong> assemble three chicken grain bowls and two tofu soba bowls. Keep sauces separate so the vegetables stay crisp.</li>
      <li><strong>70–85 min:</strong> prepare three overnight-oat jars, portion snacks, cool cooked food, label containers, and clean the workspace.</li>
    </ul>
    <div class="response-card">
      <div class="response-row"><span class="response-day">Mon</span><span class="response-meals">Chicken grain bowl · salmon, broccoli, and potatoes · Greek yogurt with berries</span></div>
      <div class="response-row"><span class="response-day">Tue</span><span class="response-meals">Overnight oats · tofu soba bowl · lemon chicken pita · apple with tahini</span></div>
      <div class="response-row"><span class="response-day">Wed</span><span class="response-meals">Egg and spinach breakfast · chicken grain bowl · tuna-cucumber salad</span></div>
      <div class="response-row"><span class="response-day">Thu</span><span class="response-meals">Overnight oats · tofu soba bowl · flexible dinner using remaining vegetables</span></div>
      <div class="response-row"><span class="response-day">Fri</span><span class="response-meals">Yogurt and fruit · final chicken bowl · freshly cooked or social dinner</span></div>
    </div>
    <p><strong>Storage:</strong> refrigerate Monday–Wednesday meals immediately. Freeze Thursday and Friday cooked protein portions once cool, then move them to the refrigerator the night before use. Keep sauces, cut cucumber, and leafy greens separate.</p>
    <p><strong>Adjustment rule:</strong> if hunger or training fatigue rises, add fruit or another half portion of grain before cutting protein or vegetables. This keeps the plan aligned with body recomposition without making the week feel restrictive.</p>`;
}

async function revealFollowUpAnswer() {
  if (state.phase !== "follow-up-thinking") return;
  state.phase = "revealing-follow-up";
  const apiResponse = await state.pendingResponse;
  if (state.phase !== "revealing-follow-up") return;
  state.phase = "second-answer-ready";
  removeThinking();
  addAssistantMessage(
    apiResponse ? modelContentToHtml(apiResponse) : followUpResponse(),
    apiResponse ? "answered with API + Q2Focus context" : "answered with Q2Focus context"
  );
  sendButton.disabled = false;
  $("#composerHint").textContent = "Second response ready";
  setFocusStatus("complete", "New reflections saved");
  reuseBar.hidden = false;
  syncReuseButtons();
  showCompletionNote("Second turn complete", "The new waiting-time answers shaped the shopping and prep plan.");
}

async function revealInitialAnswer() {
  if (state.phase !== "thinking") return;
  state.phase = "revealing";
  const apiResponse = await state.pendingResponse;
  if (state.phase !== "revealing") return;
  state.phase = "answer-ready";
  removeThinking();
  addAssistantMessage(
    apiResponse ? modelContentToHtml(apiResponse) : initialResponse(),
    apiResponse ? "API response" : "response"
  );
  if (state.lastApiError) {
    $("#connectionStatus").textContent = "API unavailable · local response used";
    $("#connectionStatus").title = state.lastApiError;
  }
  sendButton.disabled = false;
  setFocusStatus("complete", "Reflections saved");
  reuseBar.hidden = false;
  syncReuseButtons();
  updateGuide(4);
  focusStage.scrollTop = focusStage.scrollHeight;
}

function beginScenario(prompt) {
  clearTimers();
  state.phase = "thinking";
  state.firstRevealTimer = null;
  state.round = 1;
  state.currentQuestions = firstRoundQuestions;
  state.answers = {};
  state.contextAttached = false;
  state.contextEntries = [];
  state.hasRegenerated = false;
  state.initialPrompt = prompt;
  state.activePrompt = prompt;
  state.pendingResponse = startModelRequest(prompt);
  contextPreview.hidden = true;
  reuseBar.hidden = true;
  $("#welcomeCard")?.remove();
  addUserMessage(prompt);
  addThinking();
  sendButton.disabled = true;
  chatInput.value = "";
  autoResizeInput();
  schedule(() => startFocusQuestions(firstRoundQuestions), 620);
  schedule(revealInitialAnswer, 28000);
}

function regenerate() {
  const isSecondRound = state.round === 2 && state.phase === "second-answer-ready";
  if (!isSecondRound && state.phase !== "answer-ready") return;
  if (isSecondRound) {
    state.phase = "second-regenerating";
    reuseBar.hidden = true;
    setFocusStatus("active", "Latest answers in use");
    addUserMessage("Regenerate the shopping and prep plan using my latest Q2Focus answers.");
    addThinking(["Integrating the new prep constraints…", "Reordering the shopping list…", "Optimizing the Sunday timeline…"]);
    sendButton.disabled = true;
    const apiRequest = startModelRequest(
      state.activePrompt,
      `Attached context:\n${contextSummary()}\n\nLatest Q2Focus reflections:\n${answerSummary()}`
    );
    schedule(async () => {
      const apiResponse = await apiRequest;
      if (state.phase !== "second-regenerating") return;
      removeThinking();
      addAssistantMessage(
        apiResponse ? modelContentToHtml(apiResponse) : followUpResponse(),
        apiResponse ? "regenerated with API + Q2Focus" : "regenerated with latest Q2Focus answers"
      );
      state.phase = "complete";
      state.hasRegenerated = true;
      setFocusStatus("complete", "Second loop complete");
      sendButton.disabled = false;
      reuseBar.hidden = false;
      syncReuseButtons();
      showCompletionNote("Regenerated", "The second-round reflections changed the shopping and preparation plan.");
    }, 3200);
    return;
  }
  state.phase = "regenerating";
  reuseBar.hidden = true;
  setFocusStatus("active", "Answers in use");
  addUserMessage("Regenerate using my Q2Focus answers.");
  addThinking(["Integrating your preferences…", "Rebalancing the weekly plan…", "Adding practical prep cues…"]);
  sendButton.disabled = true;
  const apiRequest = startModelRequest(
    state.initialPrompt,
    `Q2Focus reflections:\n${answerSummary()}`
  );
  schedule(async () => {
    const apiResponse = await apiRequest;
    if (state.phase !== "regenerating") return;
    removeThinking();
    addAssistantMessage(
      apiResponse ? modelContentToHtml(apiResponse) : tailoredResponse(),
      apiResponse ? "regenerated with API + Q2Focus" : "regenerated with Q2Focus"
    );
    state.phase = "complete";
    state.hasRegenerated = true;
    setFocusStatus("complete", "Loop complete");
    sendButton.disabled = false;
    reuseBar.hidden = false;
    syncReuseButtons();
    showCompletionNote("Regenerated", "Your waiting-time answers changed the current response—not just the next prompt.");
  }, 2600);
}

function buildContextEntries() {
  const goal = Array.isArray(state.answers.goal) ? state.answers.goal.join(" + ") : state.answers.goal;
  const cuisine = Array.isArray(state.answers.cuisine) ? state.answers.cuisine.join(" + ") : state.answers.cuisine;
  const boundary = state.answers.restriction === "Yes"
    ? "Skip sugary drinks and highly processed foods"
    : "No strict food exclusions";
  return [
    { key: "goals", label: "Primary goals", value: goal || "Balanced energy and strength" },
    { key: "rhythm", label: "Daily structure", value: state.answers.rhythm || "3 meals + 1 snack" },
    { key: "boundaries", label: "Food boundaries", value: boundary },
    { key: "flavors", label: "Flavor direction", value: cuisine || "Asian-inspired + Mediterranean" },
    { key: "action", label: "First action", value: state.answers.action || "Prep lunches on Sunday" }
  ];
}

function fillAsContext() {
  state.contextAttached = true;
  state.contextEntries = buildContextEntries();
  contextFields.innerHTML = state.contextEntries.map((entry, index) => `
    <div class="context-field">
      <label for="context-${entry.key}">${escapeHtml(entry.label)}</label>
      <input id="context-${entry.key}" data-context-index="${index}" value="${escapeHtml(entry.value)}" />
    </div>`).join("");
  contextFields.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      state.contextEntries[Number(input.dataset.contextIndex)].value = input.value;
    });
  });
  contextPreview.hidden = false;
  chatInput.value = FOLLOW_UP_PROMPT;
  autoResizeInput();
  chatInput.focus();
  $("#composerHint").textContent = "Q2Focus answers will travel with this next message";
  showCompletionNote("Context attached", "The reflections are now structured context for your next turn. Edit the suggested prompt or send it.");
}

function showCompletionNote(title, text) {
  let note = focusStage.querySelector(".completion-note");
  if (!note) {
    note = document.createElement("div");
    note.className = "focus-intro completion-note";
    focusStage.appendChild(note);
  }
  note.innerHTML = `<span class="focus-intro-icon">✓</span><div><strong>${title}</strong><p>${text}</p></div>`;
  focusStage.scrollTop = focusStage.scrollHeight;
}

function submitFollowUp(prompt) {
  clearTimers();
  state.phase = "follow-up-thinking";
  state.round = 2;
  state.answers = {};
  state.currentQuestions = secondRoundQuestions;
  state.hasRegenerated = false;
  state.activePrompt = prompt;
  state.pendingResponse = startModelRequest(
    prompt,
    `Attached Q2Focus context:\n${contextSummary()}`
  );
  addUserMessage(prompt);
  contextPreview.hidden = true;
  state.contextAttached = false;
  addThinking(["Reading the attached Q2Focus context…", "Grouping the shopping list…", "Sequencing Sunday prep…"]);
  chatInput.value = "";
  autoResizeInput();
  sendButton.disabled = true;
  reuseBar.hidden = true;
  schedule(() => startFocusQuestions(secondRoundQuestions, {
    title: "Shape the shopping and prep plan while ChatLLM thinks.",
    description: "These are new questions for the new prompt. Your earlier context is still attached."
  }), 620);
  schedule(revealFollowUpAnswer, 15000);
}

function resetExperience() {
  clearTimers();
  state.phase = "idle";
  state.answers = {};
  state.contextAttached = false;
  state.contextEntries = [];
  state.hasRegenerated = false;
  state.round = 0;
  state.currentQuestions = firstRoundQuestions;
  state.firstRevealTimer = null;
  state.initialPrompt = "";
  state.activePrompt = "";
  state.pendingResponse = null;
  state.lastApiError = "";
  state.thinkingNode = null;
  conversation.innerHTML = `
    <div class="welcome-card" id="welcomeCard">
      <div class="welcome-symbol" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 5 29 18l14 6-14 6-5 13-5-13-14-6 14-6 5-13Z"/><path d="m39 5 1.8 4.2L45 11l-4.2 1.8L39 17l-1.8-4.2L33 11l4.2-1.8L39 5Z"/></svg></div>
      <p class="eyebrow">Interactive workspace</p>
      <h2>Ask. Stay with the thought.<br />Make the answer yours.</h2>
      <p>Q2Focus turns the model’s waiting window into a few lightweight, task-linked questions.</p>
    </div>`;
  focusStage.innerHTML = `
    <div class="focus-empty" id="focusEmpty"><div class="constellation" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><h3>Your waiting time has somewhere to go.</h3><p>Send a prompt. Q2Focus will appear during thinking—early, briefly, and tied to your task.</p><div class="principles"><span>Immediate</span><span>Optional</span><span>Task-linked</span></div></div>`;
  reuseBar.hidden = true;
  syncReuseButtons();
  contextPreview.hidden = true;
  chatInput.value = "";
  sendButton.disabled = false;
  $("#composerHint").textContent = "Type your message to begin";
  setFocusStatus("idle", "Ready");
  updateGuide(1);
  autoResizeInput();
}

function openGuide() {
  $("#drawerScrim").hidden = false;
  $("#guideDrawer").setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => $("#guideDrawer").classList.add("open"));
}

function closeGuide() {
  $("#guideDrawer").classList.remove("open");
  $("#guideDrawer").setAttribute("aria-hidden", "true");
  schedule(() => { $("#drawerScrim").hidden = true; }, 260);
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (sendButton.disabled) return;
  const prompt = chatInput.value.trim();
  if (!prompt) return;
  if (state.contextAttached) submitFollowUp(prompt);
  else beginScenario(prompt);
});

chatInput.addEventListener("input", autoResizeInput);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

$("#guideButton").addEventListener("click", openGuide);
$("#settingsButton").addEventListener("click", () => {
  if (globalThis.chrome?.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  window.alert("Model settings are available after loading this folder as a Chrome extension.");
});
$("#closeGuideButton").addEventListener("click", closeGuide);
$("#drawerScrim").addEventListener("click", closeGuide);
$("#resetButton").addEventListener("click", resetExperience);
$("#regenerateButton").addEventListener("click", regenerate);
$("#fillContextButton").addEventListener("click", fillAsContext);
$("#clearButton").addEventListener("click", clearAnswers);
$("#removeContextButton").addEventListener("click", () => {
  state.contextAttached = false;
  contextPreview.hidden = true;
  $("#composerHint").textContent = "Q2Focus context removed";
});
$("#guideCta").addEventListener("click", () => {
  closeGuide();
  if (state.phase === "idle") chatInput.focus();
  else if (state.phase === "thinking") focusStage.scrollIntoView({ behavior: "smooth", block: "center" });
  else reuseBar.scrollIntoView({ behavior: "smooth", block: "end" });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#guideDrawer").classList.contains("open")) closeGuide();
});

if (globalThis.chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener(() => loadRuntimeSettings());
}

autoResizeInput();
loadRuntimeSettings().catch(() => updateConnectionUI());
