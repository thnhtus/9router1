export default {
  id: "stepfun",
  alias: "step",
  uiAlias: "step",
  display: {
    name: "StepFun",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "SF",
    website: "https://platform.stepfun.ai",
    notice: { apiKeyUrl: "https://platform.stepfun.ai/interface-key" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.stepfun.ai/v1/chat/completions",
    validateUrl: "https://api.stepfun.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.stepfun.ai/v1/models", type: "openai" },
  passthroughModels: true,
  models: [
    { id: "step-5-preview", name: "step-5-preview" },
    { id: "step-3.7-flash", name: "step-3.7-flash" },
    { id: "step-3.5-flash", name: "step-3.5-flash" },
  ],
};
