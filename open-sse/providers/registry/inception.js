export default {
  id: "inception",
  priority: 65,
  alias: "inception",
  aliases: ["inceptionlabs", "mercury"],
  uiAlias: "incp",
  display: {
    name: "Inception Labs",
    icon: "bolt",
    color: "#7C3AED",
    textIcon: "IN",
    website: "https://www.inceptionlabs.ai",
    notice: {
      apiKeyUrl: "https://platform.inceptionlabs.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: ["instant", "low", "medium", "high"],
    defaultMode: "medium",
  },
  transport: {
    baseUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.inceptionlabs.ai/v1/models",
  },
  models: [
    { id: "mercury-3", name: "Mercury 3", contextLength: 1000000, maxOutputTokens: 131072 },
    { id: "mercury-2.5", name: "Mercury 2.5", contextLength: 260000, maxOutputTokens: 65536 },
    { id: "mercury-2", name: "Mercury 2", contextLength: 128000, maxOutputTokens: 50000 },
  ],
};
