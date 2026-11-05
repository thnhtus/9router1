export default {
  id: "sparkdesk",
  alias: "spark",
  uiAlias: "spark",
  hasFree: true,
  display: {
    name: "iFlytek Spark",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "SP",
    website: "https://xinghuo.xfyun.cn",
    notice: { apiKeyUrl: "https://console.xfyun.cn/services/cbm" },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://spark-api-open.xf-yun.com/v1/chat/completions",
    validateUrl: "https://spark-api-open.xf-yun.com/v1/models",
  },
  models: [
    { id: "lite", name: "lite" },
    { id: "pro-128k", name: "pro-128k" },
    { id: "generalv3", name: "generalv3" },
    { id: "4.0Ultra", name: "4.0Ultra" },
  ],
};
