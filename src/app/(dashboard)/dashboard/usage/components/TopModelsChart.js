"use client";

import PropTypes from "prop-types";
import RankCard from "./RankBars";

export default function TopModelsChart({ byModel }) {
  // byModel is keyed by model+provider; merge so one model is one bar.
  const merged = {};
  for (const d of Object.values(byModel || {})) {
    const name = d.rawModel || "Unknown";
    const m = (merged[name] ||= { name, tokens: 0, requests: 0 });
    m.tokens += (d.promptTokens || 0) + (d.completionTokens || 0);
    m.requests += d.requests || 0;
  }
  return <RankCard title="Top models" items={Object.values(merged)} limit={8} empty="No model usage yet" />;
}

TopModelsChart.propTypes = {
  byModel: PropTypes.object,
};
