import { useParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";

export default function AppDetail() {
  const { name = "" } = useParams();
  return <PageHeader title={name} />;
}
