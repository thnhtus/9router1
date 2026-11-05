export default {
  id: "reka",
  alias: "reka",
  uiAlias: "reka",
  display: {
    name: "Reka",
    icon: "smart_toy",
    color: "#E11D48",
    textIcon: "RK",
    website: "https://reka.ai",
    notice: { apiKeyUrl: "https://platform.reka.ai/apikeys" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.reka.ai/v1/chat/completions",
    validateUrl: "https://api.reka.ai/v1/models",
  },
  models: [
    { id: "reka-flash-3", name: "reka-flash-3" },
    { id: "reka-flash", name: "reka-flash" },
    { id: "reka-edge-2603", name: "reka-edge-2603" },
  ],
};
