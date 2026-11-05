export default {
  id: "agentrouter",
  alias: "agr",
  uiAlias: "agr",
  hasFree: true,
  display: {
    name: "AgentRouter",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "AGR",
    website: "https://agentrouter.org",
    notice: { apiKeyUrl: "https://agentrouter.org/console/token" },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://agentrouter.org/v1/chat/completions",
    validateUrl: "https://agentrouter.org/v1/models",
  },
  modelsFetcher: { url: "https://agentrouter.org/v1/models", type: "openai" },
  passthroughModels: true,
  models: [

  ],
};
