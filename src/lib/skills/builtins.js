import { registerSkill } from "./index.js";

registerSkill("code-review", {
  name: "Code Review",
  description: "Review code for bugs, risks, and improvements.",
  async run(input) {
    const code = (input && input.code) || "";
    const lines = code.split("\n").length;
    const issues = [];
    if (code.includes("eval(")) issues.push("Avoid eval()");
    if (code.includes("console.log")) issues.push("Remove console.log");
    if (!code.trim()) issues.push("Empty input");
    return { skill: "code-review", lines, issues, summary: issues.length ? issues.join("; ") : "No obvious issues" };
  },
});

registerSkill("summarize", {
  name: "Summarize",
  description: "Summarize text input.",
  async run(input) {
    const text = (input && input.text) || "";
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim()).length;
    return { skill: "summarize", words, sentences, summary: text.slice(0, 120) + (text.length > 120 ? "..." : "") };
  },
});
