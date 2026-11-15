import JevRouterCard from "./JevRouterCard";
import JevPromptCard from "./JevPromptCard";
import JevLogsCard from "./JevLogsCard";
import JevFlowCard from "./JevFlowCard";
import JevSaverCard from "./JevSaverCard";

export default function JevRouterPage() {
  return (
    <div className="flex flex-col gap-6">
      <JevRouterCard />
      <JevPromptCard />
      <JevFlowCard />
      <JevSaverCard />
      <JevLogsCard />
    </div>
  );
}
