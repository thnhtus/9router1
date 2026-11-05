export default {
  id: "bytez",
  alias: "bytez",
  uiAlias: "bytez",
  display: {
    name: "Bytez",
    icon: "smart_toy",
    color: "#8B5CF6",
    textIcon: "BZ",
    website: "https://bytez.com",
    notice: { apiKeyUrl: "https://bytez.com/api" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.bytez.com/models/v2/openai/v1/chat/completions",
    validateUrl: "https://api.bytez.com/models/v2/openai/v1/models",
  },
  modelsFetcher: { url: "https://api.bytez.com/models/v2/openai/v1/models", type: "openai" },
  passthroughModels: true,
  models: [

  ],
};
