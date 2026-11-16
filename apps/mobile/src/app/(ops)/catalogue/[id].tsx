import { useLocalSearchParams } from "expo-router";
import { OfferEditScreen } from "@/screens/offer-edit";

export default function OfferEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OfferEditScreen id={String(id)} />;
}
