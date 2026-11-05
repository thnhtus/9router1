export default {
  id: "inference-net",
  alias: "inet",
  uiAlias: "inet",
  display: {
    name: "Inference.net",
    icon: "smart_toy",
    color: "#1D4ED8",
    textIcon: "IN",
    website: "https://inference.net",
    notice: { apiKeyUrl: "https://inference.net/dashboard" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.inference.net/v1/chat/completions",
    validateUrl: "https://api.inference.net/v1/models",
  },
  modelsFetcher: { url: "https://api.inference.net/v1/models", type: "openai" },
  passthroughModels: true,
  models: [

  ],
};
