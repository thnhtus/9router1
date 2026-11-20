import { describe, it, expect } from "vitest";
import { cleanReplyText } from "../../open-sse/executors/gemini-web/domCapture.js";

describe("cleanReplyText", () => {
  it("drops trailing 'Explore related' suggestion chips", () => {
    const raw = [
      "FINAL: {\"A\":25}",
      "",
      "Explore related number theory problems:",
      "Calculate the digit sum of 25^25 using modular arithmetic",
      "Find the number of trailing zeros in 25 factorial",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe("FINAL: {\"A\":25}");
  });

  it("drops trailing 'To explore' chips", () => {
    const raw = [
      "answer 42",
      "",
      "To explore the math further:",
      "Verify the digit sum of 25^25 mathematically",
      "Optimize prime factorization for larger inputs",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe("answer 42");
  });

  it("drops 'To verify or extend this calculation' chips", () => {
    const raw = [
      "Step 4",
      "FINAL: {\"B\":148,\"C\":2}",
      "",
      "To verify or extend this calculation:",
      "Write a one-line Python self-check for A, B, and C",
      "Generalize the formula for arbitrary range upper bounds",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe("Step 4\nFINAL: {\"B\":148,\"C\":2}");
  });

  it("drops 'Want to explore ... ?' chips", () => {
    const raw = [
      "4",
      "",
      "Want to explore basic math further?",
      "Explore order of operations with simple examples",
      "Test my basic arithmetic with a quick quiz",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe("4");
  });

  it("keeps structured answers whose numbered headings are prose", () => {
    const raw = [
      "Step 3:",
      "148 factors as 2^2 x 37, so C = 2.",
      "",
      "Step 4",
      "FINAL: {\"A\":25,\"B\":148,\"C\":2}",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe(raw);
  });

  it("leaves normal text untouched", () => {
    expect(cleanReplyText("  plain reply  ")).toBe("plain reply");
  });

  it("handles empty input", () => {
    expect(cleanReplyText("")).toBe("");
    expect(cleanReplyText(null)).toBe("");
  });
});
