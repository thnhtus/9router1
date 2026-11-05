export default {
  id: "novita",
  alias: "novita",
  uiAlias: "novita",
  display: {
    name: "Novita AI",
    icon: "smart_toy",
    color: "#22C55E",
    textIcon: "NV",
    website: "https://novita.ai",
    notice: { apiKeyUrl: "https://novita.ai/settings/key-management" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.novita.ai/openai/v1/chat/completions",
    validateUrl: "https://api.novita.ai/openai/v1/models",
  },
  modelsFetcher: { url: "https://api.novita.ai/openai/v1/models", type: "openai" },
  passthroughModels: true,
  models: [
    { id: "deepseek/deepseek-v4-pro", name: "deepseek/deepseek-v4-pro" },
    { id: "deepseek/deepseek-v4-flash", name: "deepseek/deepseek-v4-flash" },
    { id: "deepseek/deepseek-v3.2", name: "deepseek/deepseek-v3.2" },
    { id: "moonshotai/kimi-k3", name: "moonshotai/kimi-k3" },
  ],
};
