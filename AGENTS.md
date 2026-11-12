<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Development / testing rules

- Nếu dự án đang chạy (dev server/proxy/service đã có process/port hoạt động), **không tự mở port mới**. Hãy xác định port đang chạy và test trực tiếp trên port đó. Chỉ mở port/process mới khi user yêu cầu rõ ràng hoặc xác nhận không có port nào đang chạy.
