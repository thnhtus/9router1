export default {
  id: "gemini-web",
  priority: 220,
  alias: "gemini-web",
  aliases: [
    "gweb",
  ],
  uiAlias: "gemini-web",
  display: {
    name: "Gemini Web",
    icon: "auto_awesome",
    color: "#4285F4",
    textIcon: "GW",
    website: "https://gemini.google.com",
  },
  category: "webCookie",
  authType: "cookie",
  serviceKinds: ["llm", "image"],
  authHint: "Paste your __Secure-1PSID (and __Secure-1PSIDTS) cookie value(s) from gemini.google.com",
  transport: {
    baseUrl: "https://gemini.google.com/app",
    format: "openai",
    authType: "cookie",
  },
  // `supportsReasoning` is omitted deliberately: the executor drives the
  // gemini.google.com web UI by typing a prompt, so it has no thinking-budget
  // control to set and never surfaces `reasoning_content`. Tool calling is
  // prompt-emulated only (translator/webTools.js), never native.
  //
  // Model list mirrors the REAL mode picker on gemini.google.com (calibrated
  // 2026-11-19): Auto (default), Everyday help (Hydrogen), Deeper analysis
  // (Neon), plus the image generator. The Gemini UI has no separate
  // "flash"/"pro/or" selectable modes, so only these are advertised.
  models: [
    { id: "gemini-web-auto", name: "Gemini Web (Auto)" },
    { id: "gemini-web-hydrogen", name: "Gemini Web (Everyday help)" },
    { id: "gemini-web-neon", name: "Gemini Web (Deeper analysis)" },
    { id: "gemini-image", name: "Gemini Image (web)", params: ["n", "size"], kind: "image" },
  ],
};
