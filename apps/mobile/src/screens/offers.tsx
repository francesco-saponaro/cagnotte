import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useOffers, type OffersQuery } from "../api/queries";
import type { OfferRow } from "../api/types";
import { formatRate } from "../ui/format";
import { useNav } from "../ui/nav";
import { Card, Empty, Failed, Loading, Money, Pager, Segmented, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, font, radius, size, space } from "../ui/tokens";

/*
 * "What can I earn where I am about to buy?" The list is the server's page: search, category and
 * sort go in the query and the API answers with twenty rows and the total.
 */

export const CATEGORIES = ["fashion", "home", "sport", "culture", "travel", "beauty", "tech", "kids", "food", "health", "finance"] as const;

const SORTS = [
  { value: "rate", label: "Highest rate" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "A to Z" },
] as const;

export function OffersScreen() {
  const wide = useWide();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<OffersQuery["sort"]>("rate");
  const [page, setPage] = useState(1);
  const query: OffersQuery = { q: q.trim() || undefined, category: category === "all" ? undefined : category, sort, page, pageSize: 20 };
  const offers = useOffers(query);
  const total = offers.data?.total;

  const change = <V,>(set: (v: V) => void) => (v: V) => {
    set(v);
    setPage(1);
  };

  return (
    <Screen>
      <TitleRow title="Offers" line={total === undefined ? "Live offers, highest rate first." : `${total} live offers. Activate one before you buy; the rate you see is the rate you get.`} />
      <View style={[styles.toolbar, wide ? styles.toolbarWide : null]}>
        <TextInput
          aria-label="Search offers"
          placeholder="Search a shop or an offer"
          placeholderTextColor={colors.faint}
          value={q}
          onChangeText={change(setQ)}
          autoCapitalize="none"
          returnKeyType="search"
          style={[styles.search, font(400), wide ? styles.searchWide : null]}
        />
        <Segmented label="Sort" options={SORTS} value={sort ?? "rate"} onChange={change(setSort)} />
      </View>
      <View style={styles.categories}>
        <Segmented label="Category" options={[{ value: "all", label: "All" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]} value={category} onChange={change(setCategory)} scroll={!wide} />
      </View>
      <Card pad={false} style={styles.list}>
        {offers.isPending ? (
          <View style={styles.pad}>
            <Loading rows={5} height={24} />
          </View>
        ) : offers.isError ? (
          <View style={styles.pad}>
            <Failed message={offers.error.message} onRetry={() => void offers.refetch()} />
          </View>
        ) : offers.data.items.length === 0 ? (
          <View style={styles.pad}>
            <Empty>No live offer matches {q.trim() ? `"${q.trim()}"` : "that"}{category !== "all" ? ` in ${category}` : ""}.</Empty>
          </View>
        ) : (
          offers.data.items.map((offer, i) => <OfferLine key={offer.id} offer={offer} last={i === offers.data.items.length - 1} />)
        )}
      </Card>
      {offers.data ? <Pager page={offers.data.page} pageSize={offers.data.pageSize} total={offers.data.total} count={offers.data.items.length} onPage={setPage} /> : null}
    </Screen>
  );
}

/** "Maison Vernet: 6 % back on everything" → "6 % back on everything" when the merchant is named beside it. */
export function titleWithoutMerchant(title: string, merchant: string): string {
  const prefix = `${merchant}:`;
  return title.startsWith(prefix) ? title.slice(prefix.length).trim() : title;
}

export function MerchantMark({ name }: { name: string }) {
  return (
    <View style={styles.mark} aria-hidden>
      <T variant="body" weight={500}>
        {name.trim().charAt(0).toUpperCase()}
      </T>
    </View>
  );
}

function OfferLine({ offer, last }: { offer: OfferRow; last: boolean }) {
  const { Link } = useNav();
  const wide = useWide();
  return (
    <Link href={`/offers/${offer.id}`} aria-label={`${offer.merchant.name}, ${offer.title}`} style={[styles.line, last ? null : styles.lineRule]}>
      <View style={styles.lineInner}>
        <MerchantMark name={offer.merchant.name} />
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {offer.merchant.name}
          </T>
          <T variant="small" numberOfLines={1}>
            {titleWithoutMerchant(offer.title, offer.merchant.name)}
            {offer.newCustomersOnly && !/new customers/i.test(offer.title) ? " · new customers" : ""}
            {offer.kind === "voucher" ? " · voucher" : ""}
          </T>
        </View>
        {wide ? (
          <View style={styles.lineMiddle}>
            <T variant="body">{offer.merchant.category}</T>
            <T variant="small">pays about {offer.validationDays} days after the order</T>
          </View>
        ) : null}
        <View style={styles.lineRate}>
          <Money variant="section" style={styles.rate}>
            {formatRate(offer)}
          </Money>
          {offer.minSpendCents > 0 ? (
            <T variant="small" num align="right">
              from {formatRate({ rateKind: "fixed", rateBps: 0, fixedCents: offer.minSpendCents })}
            </T>
          ) : null}
        </View>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: space.gap, marginBottom: space.gap },
  toolbarWide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  search: { height: space.control, borderWidth: 1, borderColor: colors.control, borderRadius: radius.control, paddingHorizontal: 12, fontSize: size.body, color: colors.text, backgroundColor: colors.surface },
  searchWide: { width: 320 },
  categories: { marginBottom: 20 },
  list: { overflow: "hidden" },
  pad: { padding: space.card },
  line: { minHeight: 64, justifyContent: "center", paddingHorizontal: space.card },
  lineRule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  lineInner: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  lineText: { flex: 1, minWidth: 0, marginLeft: 12 },
  lineMiddle: { width: 300, marginLeft: 16 },
  lineRate: { marginLeft: 16, alignItems: "flex-end", minWidth: 96 },
  rate: { fontSize: size.section, lineHeight: 22 },
  mark: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
});
