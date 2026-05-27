import { useQuery } from "@tanstack/react-query";
import { fetchIntegrations } from "../api";

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Integrations</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data?.integrations?.map((i: { name: string; version: string }) => (
          <div key={i.name} className="bg-white p-4 rounded shadow">
            <div className="font-medium">{i.name}</div>
            <div className="text-sm text-gray-500">{i.version}</div>
            <button className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-sm">
              Connect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
