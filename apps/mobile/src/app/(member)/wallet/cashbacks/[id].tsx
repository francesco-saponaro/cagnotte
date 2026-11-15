import { useLocalSearchParams } from "expo-router";
import { CashbackDetailScreen } from "@/screens/cashback-detail";

export default function CashbackDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CashbackDetailScreen id={String(id)} />;
}
