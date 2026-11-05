export default {
  id: "deepinfra",
  alias: "di",
  uiAlias: "di",
  display: {
    name: "DeepInfra",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "DI",
    website: "https://deepinfra.com",
    notice: { apiKeyUrl: "https://deepinfra.com/dash/api_keys" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.deepinfra.com/v1/openai/chat/completions",
    validateUrl: "https://api.deepinfra.com/v1/openai/models",
  },
  modelsFetcher: { url: "https://api.deepinfra.com/v1/openai/models", type: "openai" },
  passthroughModels: true,
  models: [

  ],
};
