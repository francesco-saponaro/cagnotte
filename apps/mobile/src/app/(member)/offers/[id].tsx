import { useLocalSearchParams } from "expo-router";
import { OfferDetailScreen } from "@/screens/offer-detail";

export default function OfferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OfferDetailScreen id={String(id)} />;
}
