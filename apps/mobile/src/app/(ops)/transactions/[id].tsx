import { useLocalSearchParams } from "expo-router";
import { TransactionScreen } from "@/screens/transaction";

export default function Transaction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TransactionScreen id={String(id)} />;
}
