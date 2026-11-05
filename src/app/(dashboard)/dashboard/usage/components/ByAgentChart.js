"use client";

import PropTypes from "prop-types";
import RankCard from "./RankBars";

// byAgent keys are `${rig}|${seat}`; "-" marks a missing part (untagged traffic).
export default function ByAgentChart({ byAgent }) {
  const items = Object.entries(byAgent || {}).map(([key, d]) => {
    const [rig, seat] = key.split("|");
    return {
      name: seat && seat !== "-" ? `${rig} · ${seat}` : rig,
      tokens: (d.promptTokens || 0) + (d.completionTokens || 0),
      requests: d.requests || 0,
    };
  });
  return <RankCard title="By rig / seat" items={items} limit={8} empty="No rig or seat traffic yet" />;
}

ByAgentChart.propTypes = {
  byAgent: PropTypes.object,
};
