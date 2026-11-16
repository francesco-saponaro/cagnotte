import { StyleSheet, View } from "react-native";
import { useCreateOffer, useMerchants } from "../api/ops-queries";
import { useNav } from "../ui/nav";
import { Card, Loading } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { OfferForm } from "./offer-form";

/** A new offer starts as a draft; it goes live from its own screen when the manager publishes it. */
export function NewOfferScreen() {
  const nav = useNav();
  const wide = useWide();
  const merchants = useMerchants();
  const create = useCreateOffer();
  return (
    <Screen>
      <TitleRow title="New offer" back="/catalogue" line="Rates in percent, amounts in euros; the offer is saved as a draft and published from its own screen." />
      <View style={[styles.wrap, wide ? styles.wrapWide : null]}>
        <Card>
          {merchants.isPending ? (
            <Loading rows={3} height={24} />
          ) : (
            <OfferForm mode="create" merchants={merchants.data ?? []} submitLabel="Create the offer" busy={create.isPending} onSubmit={async (wire) => nav.replace(`/catalogue/${(await create.mutateAsync(wire)).id}`)} />
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  wrapWide: { maxWidth: 640 },
});
