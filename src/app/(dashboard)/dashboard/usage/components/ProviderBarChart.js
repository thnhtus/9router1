"use client";

import PropTypes from "prop-types";
import RankCard from "./RankBars";

export default function ProviderBarChart({ byProvider }) {
  const items = Object.entries(byProvider || {}).map(([id, d]) => ({
    name: id,
    tokens: (d.promptTokens || 0) + (d.completionTokens || 0),
    requests: d.requests || 0,
  }));
  return <RankCard title="By provider" items={items} limit={8} empty="No provider usage yet" />;
}

ProviderBarChart.propTypes = {
  byProvider: PropTypes.object,
};
