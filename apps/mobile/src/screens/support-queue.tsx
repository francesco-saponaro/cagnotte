import type { ClaimStatus } from "@cagnotte/domain";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useClaimsQueue } from "../api/ops-queries";
import type { ClaimRow } from "../api/types";
import { useSession } from "../app-context";
import { formatDate, formatEuros, inDays } from "../ui/format";
import { useNav } from "../ui/nav";
import { Card, Empty, Failed, Loading, Money, Pager, Pill, Segmented, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, font, radius, size, space } from "../ui/tokens";
import { CLAIM_TONE } from "./claims";
import { MerchantMark } from "./offers";

/*
 * "Which claims are waiting on me?" The queue an agent works: every member's claims, filtered on
 * the server by status, by assignee ("Mine") and by the order reference or the member's name,
 * newest first. The line under the title counts the ones on the page nobody has taken yet.
 */

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "filed", label: "Filed" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "raised", label: "Raised" },
  { value: "credited", label: "Credited" },
  { value: "declined", label: "Declined" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const WHOSE = [
  { value: "everyone", label: "Everyone's" },
  { value: "mine", label: "Mine" },
] as const;

/** Where the claim is, in the agent's words: what the next step is. */
export const NEXT_STEP: Record<ClaimStatus, string> = {
  filed: "waiting to be taken",
  acknowledged: "being checked",
  raised: "with the network",
  credited: "credited",
  declined: "declined",
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The queue's total in words, for the line under the title. */
export function queueLine(status: StatusFilter, total: number | undefined, unassigned: number): string {
  if (total === undefined) return "Purchases whose cashback never showed, as the members reported them.";
  if (total === 0) return status === "all" || status === "filed" ? "No claim waits; every one filed has been answered." : `No claim is ${status}.`;
  const head = status === "all" ? `${plural(total, "claim")} in all` : `${plural(total, "claim")} ${status}`;
  return unassigned > 0 ? `${head}; ${unassigned} on this page nobody has taken yet.` : `${head}.`;
}

export function SupportQueueScreen() {
  const wide = useWide();
  const session = useSession();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [whose, setWhose] = useState<(typeof WHOSE)[number]["value"]>("everyone");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const query = {
    status: status === "all" ? undefined : status,
    assignee: whose === "mine" ? (session.user?.id ?? undefined) : undefined,
    q: q.trim() || undefined,
    page,
    pageSize: 20,
  };
  const claims = useClaimsQueue(query);
  const items = claims.data ? claims.data.items : [];
  const unassigned = items.filter((c) => c.status === "filed" && !c.assigneeId).length;

  const choose = <V,>(set: (v: V) => void) => (v: V) => {
    set(v);
    setPage(1);
  };

  return (
    <Screen>
      <TitleRow title="Support" line={queueLine(status, claims.data?.total, unassigned)} />
      <View style={[styles.toolbar, wide ? styles.toolbarWide : null]}>
        <TextInput
          aria-label="Search claims"
          placeholder="Order reference or member"
          placeholderTextColor={colors.faint}
          value={q}
          onChangeText={choose(setQ)}
          autoCapitalize="none"
          returnKeyType="search"
          style={[styles.search, font(400), wide ? styles.searchWide : null]}
        />
        <Segmented options={WHOSE} value={whose} onChange={choose(setWhose)} label="Whose claims" />
      </View>
      <View style={styles.statuses}>
        <Segmented options={STATUS_FILTERS} value={status} onChange={choose(setStatus)} label="Status" scroll={!wide} />
      </View>
      <Card pad={false} style={styles.list}>
        {claims.isPending ? (
          <View style={styles.pad}>
            <Loading rows={4} height={24} />
          </View>
        ) : claims.isError ? (
          <View style={styles.pad}>
            <Failed message={claims.error.message} onRetry={() => void claims.refetch()} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.pad}>
            <Empty>Nothing here. A member files a claim from their wallet when a purchase never showed as cashback.</Empty>
          </View>
        ) : (
          items.map((c, i) => <ClaimLine key={c.id} claim={c} last={i === items.length - 1} />)
        )}
      </Card>
      {claims.data ? <Pager page={claims.data.page} pageSize={claims.data.pageSize} total={claims.data.total} count={claims.data.items.length} onPage={setPage} /> : null}
    </Screen>
  );
}

function ClaimLine({ claim, last }: { claim: ClaimRow; last: boolean }) {
  const { Link } = useNav();
  const wide = useWide();
  const meta = `${claim.member.displayName} · ordered ${formatDate(claim.orderedAt)} · filed ${inDays(claim.filedAt)}`;
  return (
    <Link href={`/support/${claim.id}`} aria-label={`${claim.member.displayName}, ${claim.offer.merchant.name}, ${claim.orderRef}, ${claim.status}`} style={[styles.line, last ? null : styles.rule]}>
      <View style={styles.lineInner}>
        <MerchantMark name={claim.offer.merchant.name} />
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {claim.offer.merchant.name} · {claim.orderRef}
          </T>
          {wide ? (
            <T variant="small" numberOfLines={1}>
              ordered {formatDate(claim.orderedAt)} · filed {inDays(claim.filedAt)}
            </T>
          ) : (
            <T variant="small" numberOfLines={1}>
              {meta}
            </T>
          )}
        </View>
        {wide ? (
          <View style={styles.lineMember}>
            <T variant="body" numberOfLines={1}>
              {claim.member.displayName}
            </T>
            <T variant="small" numberOfLines={1}>
              {claim.assigneeId ? NEXT_STEP[claim.status] : claim.status === "filed" ? "nobody has taken it" : NEXT_STEP[claim.status]}
            </T>
          </View>
        ) : null}
        <View style={styles.lineRight}>
          <Money variant="section">{formatEuros(claim.orderCents)}</Money>
          <Pill tone={CLAIM_TONE[claim.status]}>{claim.status}</Pill>
        </View>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: space.gap, marginBottom: space.gap },
  toolbarWide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  search: { height: 32, borderWidth: 1, borderColor: colors.control, borderRadius: radius.control, paddingHorizontal: 12, fontSize: size.body, color: colors.text, backgroundColor: colors.surface },
  searchWide: { width: 320 },
  statuses: { marginBottom: 20 },
  list: { overflow: "hidden" },
  pad: { padding: space.card },
  line: { minHeight: 72, justifyContent: "center", paddingHorizontal: space.card },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  lineInner: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  lineText: { flex: 1, minWidth: 0, marginLeft: 12 },
  lineMember: { width: 260, marginLeft: 16 },
  lineRight: { marginLeft: 16, alignItems: "flex-end", gap: 4, minWidth: 96 },
});
