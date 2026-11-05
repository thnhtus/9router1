export default {
  id: "monsterapi",
  alias: "monster",
  uiAlias: "monster",
  display: {
    name: "MonsterAPI",
    icon: "smart_toy",
    color: "#F97316",
    textIcon: "MA",
    website: "https://monsterapi.ai",
    notice: { apiKeyUrl: "https://monsterapi.ai/user/dashboard" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.monsterapi.ai/v1/chat/completions",
    validateUrl: "https://api.monsterapi.ai/v1/models",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
  ],
};
