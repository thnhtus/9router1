export default {
  id: "nscale",
  alias: "nscale",
  uiAlias: "nscale",
  display: {
    name: "Nscale",
    icon: "smart_toy",
    color: "#0EA5E9",
    textIcon: "NS",
    website: "https://nscale.com",
    notice: { apiKeyUrl: "https://console.nscale.com" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.api.nscale.com/v1/chat/completions",
    validateUrl: "https://inference.api.nscale.com/v1/models",
  },
  modelsFetcher: { url: "https://inference.api.nscale.com/v1/models", type: "openai" },
  passthroughModels: true,
  models: [

  ],
};
