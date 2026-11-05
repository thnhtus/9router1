export default {
  id: "longcat",
  alias: "longcat",
  uiAlias: "longcat",
  hasFree: true,
  display: {
    name: "LongCat",
    icon: "smart_toy",
    color: "#F59E0B",
    textIcon: "LC",
    website: "https://longcat.chat",
    notice: { apiKeyUrl: "https://longcat.chat/platform/api_keys" },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.longcat.chat/openai/v1/chat/completions",
    validateUrl: "https://api.longcat.chat/openai/v1/models",
  },
  models: [
    { id: "LongCat-2.0", name: "LongCat-2.0" },
  ],
};
