import { useLocalSearchParams } from "expo-router";
import { ClaimCaseScreen } from "@/screens/claim-case";

export default function ClaimCase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClaimCaseScreen id={String(id)} />;
}
