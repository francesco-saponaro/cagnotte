import { useLocalSearchParams } from "expo-router";
import { ClaimDetailScreen } from "@/screens/claim-detail";

export default function ClaimDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClaimDetailScreen id={String(id)} />;
}
