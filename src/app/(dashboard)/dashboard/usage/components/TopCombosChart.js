"use client";

import PropTypes from "prop-types";
import RankCard from "./RankBars";

export default function TopCombosChart({ byCombo }) {
  const items = Object.entries(byCombo || {}).map(([name, d]) => ({
    name,
    tokens: (d.promptTokens || 0) + (d.completionTokens || 0),
    requests: d.requests || 0,
  }));
  return <RankCard title="Top combos" items={items} limit={8} empty="No combo usage yet" />;
}

TopCombosChart.propTypes = {
  byCombo: PropTypes.object,
};