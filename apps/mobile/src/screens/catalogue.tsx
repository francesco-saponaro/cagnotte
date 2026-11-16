import type { OfferStatus } from "@cagnotte/domain";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useCatalogue, type CatalogueQuery } from "../api/ops-queries";
import type { OfferRow } from "../api/types";
import { formatDay, formatRate } from "../ui/format";
import { useNav } from "../ui/nav";
import { Card, Empty, Failed, LinkButton, Loading, Money, Pager, Pill, Segmented, T, type PillTone } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, font, radius, size, space } from "../ui/tokens";
import { CATEGORIES, MerchantMark, titleWithoutMerchant } from "./offers";

/*
 * "What is on offer, and what is not live?" The catalogue as the manager sees it: every status,
 * not only the live offers a member browses, with the same server-side search, category and sort.
 */

const SORTS = [
  { value: "rate", label: "Highest rate" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "A to Z" },
] as const;

export const OFFER_TONE: Record<OfferStatus, PillTone> = { draft: "neutral", live: "positive", paused: "warning", ended: "neutral" };

/** "89 offers, 68 live." from the page in hand; the live count is the page's when the list is longer than one page. */
export function catalogueLine(total: number | undefined, items: OfferRow[] | undefined): string {
  if (total === undefined || !items) return "Every offer, whatever its status; members only see the live ones.";
  if (total === 0) return "No offer yet.";
  const live = items.filter((o) => o.status === "live").length;
  const onPage = items.length < total ? " on this page" : "";
  return `${total} offer${total === 1 ? "" : "s"}, ${live} live${onPage}.`;
}

export function CatalogueScreen() {
  const wide = useWide();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<CatalogueQuery["sort"]>("newest");
  const [page, setPage] = useState(1);
  const query: CatalogueQuery = { q: q.trim() || undefined, category: category === "all" ? undefined : category, sort, page, pageSize: 20 };
  const offers = useCatalogue(query);

  const change = <V,>(set: (v: V) => void) => (v: V) => {
    set(v);
    setPage(1);
  };

  return (
    <Screen>
      <TitleRow title="Catalogue" line={catalogueLine(offers.data?.total, offers.data?.items)} action={<LinkButton href="/catalogue/new" label="New offer" />} />
      <View style={[styles.toolbar, wide ? styles.toolbarWide : null]}>
        <TextInput
          aria-label="Search the catalogue"
          placeholder="Search a shop or an offer"
          placeholderTextColor={colors.faint}
          value={q}
          onChangeText={change(setQ)}
          autoCapitalize="none"
          returnKeyType="search"
          style={[styles.search, font(400), wide ? styles.searchWide : null]}
        />
        <Segmented label="Sort" options={SORTS} value={sort ?? "newest"} onChange={change(setSort)} />
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
            <Empty>
              No offer matches {q.trim() ? `"${q.trim()}"` : "that"}
              {category !== "all" ? ` in ${category}` : ""}. A new one starts as a draft and goes live when you publish it.
            </Empty>
          </View>
        ) : (
          offers.data.items.map((offer, i) => <CatalogueLine key={offer.id} offer={offer} last={i === offers.data.items.length - 1} />)
        )}
      </Card>
      {offers.data ? <Pager page={offers.data.page} pageSize={offers.data.pageSize} total={offers.data.total} count={offers.data.items.length} onPage={setPage} /> : null}
    </Screen>
  );
}

function CatalogueLine({ offer, last }: { offer: OfferRow; last: boolean }) {
  const { Link } = useNav();
  const wide = useWide();
  const window = `${formatDay(offer.startsAt)} to ${offer.endsAt ? formatDay(offer.endsAt) : "no end"}`;
  return (
    <Link href={`/catalogue/${offer.id}`} aria-label={`${offer.merchant.name}, ${offer.title}, ${offer.status}`} style={[styles.line, last ? null : styles.lineRule]}>
      <View style={styles.lineInner}>
        <MerchantMark name={offer.merchant.name} />
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {offer.merchant.name}
          </T>
          <T variant="small" numberOfLines={1}>
            {titleWithoutMerchant(offer.title, offer.merchant.name)}
            {offer.kind === "voucher" ? " · voucher" : ""}
            {wide ? "" : ` · ${window}`}
          </T>
        </View>
        {wide ? (
          <View style={styles.lineMiddle}>
            <T variant="body">{window}</T>
            <T variant="small">validates {offer.validationDays} days after the order</T>
          </View>
        ) : null}
        <View style={styles.lineRate}>
          <Money variant="section">{formatRate(offer)}</Money>
          {offer.minSpendCents > 0 ? (
            <T variant="small" num align="right">
              from {formatRate({ rateKind: "fixed", rateBps: 0, fixedCents: offer.minSpendCents })}
            </T>
          ) : null}
        </View>
        <View style={styles.lineStatus}>
          <Pill tone={OFFER_TONE[offer.status]}>{offer.status}</Pill>
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
  lineMiddle: { width: 260, marginLeft: 16 },
  lineRate: { marginLeft: 16, alignItems: "flex-end", minWidth: 88 },
  lineStatus: { marginLeft: 16, minWidth: 64, alignItems: "flex-end" },
});
