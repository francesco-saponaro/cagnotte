import { useLocalSearchParams } from "expo-router";
import { ImportBatchScreen } from "@/screens/import-batch";

export default function ImportBatch() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ImportBatchScreen id={String(id)} />;
}
