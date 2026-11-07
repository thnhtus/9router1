"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

export default function SkillsRuntimePage() {
  const [skills, setSkills] = useState([]);
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch("/api/skills-runtime").then((r) => r.ok ? r.json() : null).then((d) => d && setSkills(d.skills || []));
  }, []);

  const run = async () => {
    let parsed = {};
    try { parsed = input ? JSON.parse(input) : {}; } catch { parsed = { text: input }; }
    const res = await fetch("/api/skills-runtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill: selected, input: parsed }) });
    const d = await res.json();
    setResult(d.result || d);
  };

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">Skills (Runtime)</h1>
      <Card padding="md">
        <div className="flex gap-2">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="">select skill</option>
            {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder='{"text":"..."}' className="flex-1 border rounded px-2 py-1 text-sm" />
          <button onClick={run} className="px-3 py-1 bg-primary text-white rounded text-sm">Run</button>
        </div>
      </Card>
      {result && <Card padding="md"><pre className="text-xs">{JSON.stringify(result, null, 2)}</pre></Card>}
    </div>
  );
}
