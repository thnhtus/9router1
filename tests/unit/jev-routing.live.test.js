/**
 * Live Jev routing eval: 30 labelled tasks (L1–L4) routed through the real router over the
 * brain + worker members. Hit = picked model's cost tier fits the task level.
 * Calls the real router model (costs tokens): JEV_EVAL=1 npx vitest run unit/jev-routing.live.test.js
 * Report: /tmp/jev-eval.json (per-task choice, tier, confidence, latency).
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { resolveSmartChoice } from "@/sse/services/systemoneRouter.js";
import { getModelTiers } from "@/lib/llmStats.js";
import { getComboModels } from "@/sse/services/model.js";

const FITS = { 1: ["free", "cheap"], 2: ["free", "cheap", "mid"], 3: ["cheap", "mid", "premium"], 4: ["premium"] };

const TASKS = [
  [1, "Đổi chuỗi 'hello world' thành chữ hoa."],
  [1, "What is the HTTP status code for Not Found?"],
  [1, "Format this JSON: {\"a\":1,\"b\":[1,2]}"],
  [1, "Dịch sang tiếng Anh: 'Cảm ơn bạn đã giúp đỡ'."],
  [1, "List the git command to show the current branch."],
  [1, "Viết regex khớp số điện thoại 10 chữ số."],
  [1, "Convert 72 Fahrenheit to Celsius."],
  [1, "Tóm tắt câu này trong 5 từ: 'Hệ thống đang chạy ổn định sau khi khởi động lại'."],
  [2, "Thêm validate email vào hàm registerUser trong src/auth.js, trả 400 nếu sai định dạng."],
  [2, "Write a bash script that deletes .log files older than 7 days in /var/log/app."],
  [2, "Fix the off-by-one in: for (let i = 0; i <= arr.length; i++) sum += arr[i];"],
  [2, "Viết unit test vitest cho hàm slugify(str) chuyển 'Xin Chào' thành 'xin-chao'."],
  [2, "Add a loading spinner to the Save button in this React component while the request is pending."],
  [2, "Explain the difference between Promise.all and Promise.allSettled with an example."],
  [2, "Viết SQL lấy 10 user đăng ký gần nhất từ bảng users."],
  [2, "Rename the prop `isOpen` to `open` in Modal.jsx and its two callers."],
  [3, "API /orders thỉnh thoảng trả 500 dưới tải cao, log chỉ có 'connection reset'. Tìm nguyên nhân và sửa trong pool DB + retry."],
  [3, "Implement pagination with cursor across the orders API, the repo layer and the React table, keeping existing filters working."],
  [3, "Memory leak in our Node service: heap grows 50MB/hour. Here are the heap snapshots diffs... find the root cause."],
  [3, "Thêm tính năng export CSV cho báo cáo doanh thu: backend stream, frontend nút tải, test cho cả hai."],
  [3, "Our websocket reconnect logic causes duplicate messages after network flaps. Debug and fix across client and server."],
  [3, "Refactor the payment webhook handler so it is idempotent; must not double-charge. Update tests."],
  [3, "Tích hợp OAuth Google vào app Next.js hiện có, giữ nguyên đăng nhập email/password."],
  [3, "Race condition: two workers sometimes process the same job from the Redis queue. Find and fix."],
  [4, "Thiết kế kiến trúc migrate toàn bộ hệ thống từ MongoDB sang Postgres không downtime, gồm dual-write, backfill, cutover và rollback."],
  [4, "Design a multi-tenant architecture for our SaaS: data isolation, billing, per-tenant rate limits, and a migration plan from single-tenant."],
  [4, "Plan the database schema migration that drops and rewrites the transactions table in production with 2B rows."],
  [4, "Chọn giữa microservices và modular monolith cho hệ thống 40 dev, phân tích trade-off và lộ trình chuyển đổi."],
  [4, "Audit our auth system end to end for security holes (JWT, refresh tokens, CSRF, session fixation) and propose a redesign."],
  [4, "Design event-sourcing + CQRS for the ledger service so balances are always exactly correct, including replay and snapshotting."],
];

describe.skipIf(!process.env.JEV_EVAL)("Jev routing eval (live)", () => {
  it("routes 30 labelled tasks to a fitting cost tier", async () => {
    const models = [...new Set([...(await getComboModels("brain") || []), ...(await getComboModels("worker") || [])])];
    const tiers = await getModelTiers(models);
    const rows = [];
    for (const [level, prompt] of TASKS) {
      const t0 = Date.now();
      const r = await resolveSmartChoice({ body: { messages: [{ role: "user", content: prompt }] }, models, comboName: "jev-eval", routerModel: process.env.JEV_ROUTER || "typesafe/jev-latest", timeoutMs: 20000 });
      const tier = r ? tiers[r.choice] || "unknown" : null;
      rows.push({ level, prompt: prompt.slice(0, 80), choice: r?.choice ?? null, tier, confidence: r?.confidence ?? null, ms: Date.now() - t0, hit: !!tier && FITS[level].includes(tier) });
    }
    const byLevel = Object.fromEntries([1, 2, 3, 4].map((l) => {
      const xs = rows.filter((r) => r.level === l);
      return [`L${l}`, `${xs.filter((r) => r.hit).length}/${xs.length}`];
    }));
    const hits = rows.filter((r) => r.hit).length;
    writeFileSync("/tmp/jev-eval.json", JSON.stringify({ hits, total: rows.length, byLevel, rows }, null, 2));
    console.log(`Jev eval: ${hits}/${rows.length}`, byLevel);
    expect(rows.filter((r) => r.choice).length).toBeGreaterThan(0);
  }, 30 * 25000);
});
