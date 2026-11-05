export default {
  id: "scaleway",
  alias: "scw",
  uiAlias: "scw",
  hasFree: true,
  display: {
    name: "Scaleway",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "SW",
    website: "https://www.scaleway.com/en/generative-apis/",
    notice: { apiKeyUrl: "https://console.scaleway.com/iam/api-keys" },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.scaleway.ai/v1/chat/completions",
    validateUrl: "https://api.scaleway.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.scaleway.ai/v1/models", type: "openai" },
  passthroughModels: true,
  models: [
    { id: "qwen3-235b-a22b-instruct-2507", name: "qwen3-235b-a22b-instruct-2507" },
    { id: "gpt-oss-120b", name: "gpt-oss-120b" },
    { id: "deepseek-v3-0324", name: "deepseek-v3-0324" },
    { id: "mistral-small-3.2-24b-instruct-2506", name: "mistral-small-3.2-24b-instruct-2506" },
    { id: "llama-3.1-70b-instruct", name: "llama-3.1-70b-instruct" },
    { id: "llama-3.1-8b-instruct", name: "llama-3.1-8b-instruct" },
  ],
};
