import { describe, it, expect } from "vitest";
import { cleanReplyText, isGeminiAppError } from "../../open-sse/executors/gemini-web/domCapture.js";
import { isGeminiRefusal } from "../../open-sse/executors/gemini-web.js";

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

  it("drops a live 'Want to see ...?' chip with a Yes/No option", () => {
    const raw = [
      "Oxygen: Released back into the air—the exact gas you breathe in every second.",
      "",
      "Want to see the simple science recipe behind photosynthesis?",
      "Yes",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe(
      "Oxygen: Released back into the air—the exact gas you breathe in every second."
    );
  });

  it("drops a trailing question heading even when it has no known chip keyword", () => {
    const raw = [
      "A hash table maps keys to values with average O(1) lookup.",
      "",
      "Curious how collisions are handled?",
      "Show probing",
      "Show chaining",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe("A hash table maps keys to values with average O(1) lookup.");
  });

  it("keeps a question heading when the lines below it are prose, not chip titles", () => {
    const raw = [
      "So what is a BST?",
      "A binary search tree stores keys in sorted order.",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe(raw);
  });

  it("keeps a plain visual list without a chip heading", () => {
    const raw = [
      "Key requirements:",
      "Hashable keys for a hash table",
      "Comparable keys for a BST",
    ].join("\n");
    expect(cleanReplyText(raw)).toBe(raw);
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

describe("isGeminiAppError", () => {
  it("detects the inline Gemini error card text", () => {
    expect(isGeminiAppError("Sorry, something went wrong. Please try your request again.")).toBe(true);
    expect(isGeminiAppError("I seem to be encountering an error. Can I try something else for you?")).toBe(true);
    expect(isGeminiAppError("Something went wrong, sorry about that")).toBe(true);
  });

  it("does not flag normal answers", () => {
    expect(isGeminiAppError("42")).toBe(false);
    expect(isGeminiAppError("The answer is 42 because reasons")).toBe(false);
    expect(isGeminiAppError(null)).toBe(false);
  });
});

describe("isGeminiRefusal", () => {
  it("flags canned refusals including the new Gemini error phrasing", () => {
    expect(isGeminiRefusal("I'm having a hard time fulfilling your request.")).toBe(true);
    expect(isGeminiRefusal("I seem to be encountering an error. Can I try something else for you?")).toBe(true);
  });

  it("does not flag real answers", () => {
    expect(isGeminiRefusal("The answer is 42.")).toBe(false);
  });
});
