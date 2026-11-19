import ComboErrorsCard from "./ComboErrorsCard";
import FallbackChainCard from "../combos/FallbackChainCard";

export default function ComboErrorsPage() {
  return (
    <div className="flex flex-col gap-6">
      <ComboErrorsCard />
      <FallbackChainCard />
    </div>
  );
}
