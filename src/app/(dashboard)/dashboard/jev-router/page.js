import JevRouterCard from "./JevRouterCard";
import JevLogsCard from "./JevLogsCard";
import JevFlowCard from "./JevFlowCard";
import JevSaverCard from "./JevSaverCard";

export default function JevRouterPage() {
  return (
    <div className="flex flex-col gap-6">
      <JevRouterCard />
      <JevFlowCard />
      <JevSaverCard />
      <JevLogsCard />
    </div>
  );
}
