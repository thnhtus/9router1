// TypeSafe Jev — first-party System One decision models (api.typesafe.ai).
// Same protocol as the other /v1/systemone lanes; used as the Smart Router model for combos.
// Catalog verified live 2026-11-02 via GET https://api.typesafe.ai/v1/models (jev-1.13.0 still answers).
export default {
  id: "typesafe",
  priority: 46,
  alias: "typesafe",
  uiAlias: "typesafe",
  display: {
    name: "TypeSafe Jev",
    icon: "psychology",
    color: "#0F766E",
    textIcon: "TS",
    website: "https://typesafe.ai",
    notice: {
      text: "Jev System One decision models (choice / score questions, calibrated probabilities). Pick one as the Smart Router model of a combo. Paste a TypeSafe API key (Bearer).",
      apiKeyUrl: "https://typesafe.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  models: [
    { id: "jev-latest", name: "Jev Latest", kind: "systemone" },
    { id: "jev-preview", name: "Jev Preview", kind: "systemone" },
    { id: "jev-1.13.0", name: "Jev 1.13.0", kind: "systemone" },
  ],
  serviceKinds: ["systemone"],
  systemoneConfig: {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    path: "/v1/systemone",
    authType: "apikey",
    authHeader: "bearer",
  },
};
