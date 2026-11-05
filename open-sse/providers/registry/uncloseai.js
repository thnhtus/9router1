export default {
  id: "uncloseai",
  alias: "unc",
  uiAlias: "unc",
  hasFree: true,
  display: {
    name: "UncloseAI",
    icon: "smart_toy",
    color: "#64748B",
    textIcon: "UC",
    website: "https://uncloseai.com",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://hermes.ai.unturf.com/v1/chat/completions",
    noAuth: true,
  },
  modelsFetcher: { url: "https://hermes.ai.unturf.com/v1/models", type: "openai" },
  passthroughModels: true,
  models: [
    { id: "turboderp/Qwen3.8-27B-exl3", name: "turboderp/Qwen3.8-27B-exl3" },
  ],
};
