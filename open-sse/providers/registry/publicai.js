export default {
  id: "publicai",
  alias: "pai",
  uiAlias: "pai",
  hasFree: true,
  display: {
    name: "PublicAI",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "PA",
    website: "https://publicai.co",
    notice: { apiKeyUrl: "https://platform.publicai.co" },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.publicai.co/v1/chat/completions",
    validateUrl: "https://api.publicai.co/v1/models",
  },
  modelsFetcher: { url: "https://api.publicai.co/v1/models", type: "openai" },
  passthroughModels: true,
  models: [

  ],
};
