export default {
  id: "arcee-ai",
  alias: "arcee",
  uiAlias: "arcee",
  display: {
    name: "Arcee AI",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "AR",
    website: "https://arcee.ai",
    notice: { apiKeyUrl: "https://chat.arcee.ai" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.arcee.ai/api/v1/chat/completions",
    validateUrl: "https://api.arcee.ai/api/v1/models",
  },
  modelsFetcher: { url: "https://api.arcee.ai/api/v1/models", type: "openai" },
  passthroughModels: true,
  models: [

  ],
};
