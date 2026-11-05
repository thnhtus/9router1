export default {
  id: "xkiro",
  alias: "xk",
  uiAlias: "xk",
  hasFree: true,
  display: {
    name: "xKiro",
    icon: "smart_toy",
    color: "#9333EA",
    textIcon: "XK",
    website: "https://xkiro.com",
    notice: { apiKeyUrl: "https://xkiro.com" },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.xkiro.com/v1/chat/completions",
    validateUrl: "https://api.xkiro.com/v1/models",
  },
  modelsFetcher: { url: "https://api.xkiro.com/v1/models", type: "openai" },
  passthroughModels: true,
  models: [
    { id: "minimax/minimax-m3:free", name: "minimax/minimax-m3:free" },
    { id: "minimax/minimax-m2.7:free", name: "minimax/minimax-m2.7:free" },
    { id: "qwen/qwen3.5-flash:free", name: "qwen/qwen3.5-flash:free" },
    { id: "qwen/qwen3-vl-plus:free", name: "qwen/qwen3-vl-plus:free" },
  ],
};
