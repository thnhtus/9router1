// LLM-backed skill routing test & description suggestion.
// Called from Pi CLI tools card via POST /api/cli-tools/pi-settings/skill-llm

import { NextResponse } from "next/server";
import { resolveCliApiKey } from "../../resolveApiKey.js";

export const dynamic = "force-dynamic";

const MAX_BATCH = 5;

function buildCatalog(skills) {
  // skills: [{ key, name, description }]
  return skills.map((s) => `- ${s.name}: ${s.description || "(no description)"}`).join("\n");
}

async function call9router({ baseUrl, apiKey, model, prompt, system, maxTokens = 128 }) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`9router error: ${msg}`);
  }
  const msg = data.choices?.[0]?.message || {};
  // Reasoning models can spend the whole budget on reasoning_content and return empty content.
  const text = (msg.content || "").trim();
  if (text) return text;
  const reason = (msg.reasoning_content || "").trim();
  if (reason) throw new Error("model returned only reasoning, no answer — retry or raise max_tokens");
  throw new Error("model returned an empty answer");
}

function parseSkillName(text, catalogNames) {
  // LLM should reply with exact skill name; try to find it
  const clean = text.trim();
  for (const n of catalogNames) {
    if (clean === n) return n;
    if (clean.toLowerCase() === n.toLowerCase()) return n;
    if (clean.includes(n)) return n;
  }
  // fallback: first word/line that looks like a name
  const first = clean.split(/[\n.,;]/)[0].trim();
  if (catalogNames.includes(first)) return first;
  return clean;
}

// `auto` can land on a reasoning model that spends the budget before answering; one retry is enough in practice.
async function call9routerRetry(args) {
  try {
    return await call9router(args);
  } catch (e) {
    if (!/empty answer|only reasoning/.test(e.message)) throw e;
    return await call9router({ ...args, maxTokens: (args.maxTokens || 128) * 4 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, skills, catalog } = body;
    if (!action || !Array.isArray(skills) || skills.length === 0) {
      return NextResponse.json({ error: "body must be { action: 'route'|'suggest', skills: [{name, description, key}], model? }" }, { status: 400 });
    }
    if (skills.length > MAX_BATCH) {
      return NextResponse.json({ error: `batch too large, max ${MAX_BATCH} skills per call` }, { status: 400 });
    }

    const apiKey = await resolveCliApiKey(null);
    const origin = new URL(request.url).origin;
    const useModel = "auto";

    if (action === "route") {
      // Route against the full catalog so the LLM has real distractors.
      const pool = Array.isArray(catalog) && catalog.length ? catalog : skills;
      const catalogText = buildCatalog(pool);
      const names = pool.map((s) => s.name);
      const system = `You are a skill router. Given a task description, pick the ONE most relevant skill from the catalog below. Reply ONLY with the exact skill name, nothing else.\n\nCatalog:\n${catalogText}`;
      const results = [];
      for (const target of skills) {
        const prompt = `Task: ${target.description || "(no description)"}\n\nWhich skill?`;
        try {
          const picked = await call9routerRetry({ baseUrl: origin, apiKey, model: useModel, prompt, system });
          const parsed = parseSkillName(picked, names);
          results.push({ key: target.key, name: target.name, picked: parsed, ok: parsed === target.name });
        } catch (e) {
          results.push({ key: target.key, name: target.name, picked: null, ok: false, error: e.message });
        }
      }
      // A model error is not a routing miss, so it is excluded from the rate.
      const scored = results.filter((r) => !r.error);
      const okCount = scored.filter((r) => r.ok).length;
      return NextResponse.json({
        action: "route",
        results,
        summary: {
          total: results.length,
          scored: scored.length,
          correct: okCount,
          errors: results.length - scored.length,
          rate: scored.length ? Number((okCount / scored.length).toFixed(2)) : null,
        },
      });
    }

    if (action === "suggest") {
      const target = skills[0];
      const prompt = `The skill "${target.name}" has this description:\n${target.description || "(empty)"}\n\nRewrite the description to be clearer for an LLM router. Must include: what the skill does, when to use it (explicit "Use when..."), and what tools it needs. Keep it under 200 characters. Reply ONLY with the new description.`;
      const system = "You write concise skill descriptions for an LLM router catalog.";
      const suggested = await call9routerRetry({ baseUrl: origin, apiKey, model: useModel, prompt, system, maxTokens: 600 });
      return NextResponse.json({ action: "suggest", key: target.key, original: target.description, suggested });
    }

    return NextResponse.json({ error: "action must be 'route' or 'suggest'" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: { message: e.message } }, { status: 500 });
  }
}