export default {
  id: "baichuan",
  alias: "bc",
  uiAlias: "bc",
  display: {
    name: "Baichuan",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "BC",
    website: "https://platform.baichuan-ai.com",
    notice: { apiKeyUrl: "https://platform.baichuan-ai.com/console/apikey" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.baichuan-ai.com/v1/chat/completions",
    validateUrl: "https://api.baichuan-ai.com/v1/models",
  },
  models: [
    { id: "Baichuan4-Turbo", name: "Baichuan4-Turbo" },
    { id: "Baichuan4-Air", name: "Baichuan4-Air" },
    { id: "Baichuan4", name: "Baichuan4" },
    { id: "Baichuan3-Turbo", name: "Baichuan3-Turbo" },
  ],
};
