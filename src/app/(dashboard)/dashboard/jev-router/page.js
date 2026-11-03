import JevRouterCard from "./JevRouterCard";
import JevLogsCard from "./JevLogsCard";

export default function JevRouterPage() {
  return (
    <div className="flex flex-col gap-6">
      <JevRouterCard />
      <JevLogsCard />
    </div>
  );
}
