import { StyleSheet, View } from "react-native";
import { useReferrals } from "../api/queries";
import type { ReferralsRow } from "../api/types";
import { formatDate, formatEuros } from "../ui/format";
import { Card, CardTitle, Empty, Failed, Loading, Money, Pill, T, type PillTone } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";

/*
 * "Has anyone used my code, and what did it pay?" The code to share, the sign-ups it still accepts,
 * each referee with where their referral stands, and the bonuses it has paid so far.
 */

const TONE: Record<ReferralsRow["referees"][number]["status"], PillTone> = { pending: "neutral", validated: "positive", expired: "negative" };

export function ReferralsScreen() {
  const wide = useWide();
  const referrals = useReferrals();
  return (
    <Screen>
      <TitleRow title="Referrals" line="Share your code; the bonuses pay once a friend's first cashback validates." />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <View style={wide ? styles.codeWide : null}>
          <Card>
            {referrals.isPending ? (
              <Loading rows={2} height={28} />
            ) : referrals.isError ? (
              <Failed message={referrals.error.message} onRetry={() => void referrals.refetch()} />
            ) : (
              <View>
                <T variant="section" role="heading" level={2}>
                  Your code
                </T>
                <T variant="kpi" weight={500} style={styles.code}>
                  {referrals.data.code}
                </T>
                <T variant="body" muted>
                  {referrals.data.remaining === 0 ? "This code has reached its twenty sign-ups." : `${referrals.data.remaining} more sign-up${referrals.data.remaining === 1 ? "" : "s"} accepted.`}
                </T>
                <View style={styles.bonus}>
                  <T variant="small">Bonuses paid to you so far</T>
                  <Money variant="section" strong>
                    {formatEuros(referrals.data.bonusCents)}
                  </Money>
                </View>
              </View>
            )}
          </Card>
          <Card pad={false} style={styles.rules}>
            <CardTitle>How it pays</CardTitle>
            <Rule when="Your friend's validated cashback reaches 5,00 €" what="5,00 € to them, 20,00 € to you" />
            <Rule when="For the year after that" what="10 % of their validated cashback to you" />
            <Rule when="Not within 90 days of signing up" what="the referral expires; nothing is paid" last />
          </Card>
        </View>
        <View style={wide ? styles.listWide : null}>
          <Card pad={false}>
            <CardTitle>Friends who signed up</CardTitle>
            {referrals.data ? (
              referrals.data.referees.length === 0 ? (
                <View style={styles.pad}>
                  <Empty>Nobody yet. Share the code; the bonus pays once your friend's first cashback validates.</Empty>
                </View>
              ) : (
                referrals.data.referees.map((r, i, all) => (
                  <View key={`${r.displayName}-${r.createdAt}`} style={[styles.row, i === all.length - 1 ? null : styles.rule]}>
                    <View style={styles.rowText}>
                      <T variant="body" weight={500}>
                        {r.displayName}
                      </T>
                      <T variant="small">
                        signed up {formatDate(r.createdAt)}
                        {r.status === "validated" && r.validatedAt ? ` · validated ${formatDate(r.validatedAt)}` : r.status === "pending" && r.expiresAt ? ` · needs 5,00 € validated by ${formatDate(r.expiresAt)}` : ""}
                      </T>
                    </View>
                    <Pill tone={TONE[r.status]}>{r.status}</Pill>
                  </View>
                ))
              )
            ) : (
              <View style={styles.pad}>
                <Loading rows={3} />
              </View>
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}

function Rule({ when, what, last }: { when: string; what: string; last?: boolean }) {
  return (
    <View style={[styles.ruleRow, last ? null : styles.rule]}>
      <T variant="small">{when}</T>
      <T variant="body">{what}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  rules: { marginTop: space.pad },
  ruleRow: { paddingHorizontal: space.card, paddingVertical: 10 },
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  codeWide: { width: 360 },
  listWide: { flex: 1 },
  code: { marginTop: 4 },
  bonus: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.rule },
  pad: { padding: space.card },
  row: { flexDirection: "row", alignItems: "center", minHeight: 60, paddingHorizontal: space.card, paddingVertical: 10 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  rowText: { flex: 1, minWidth: 0, marginRight: 12 },
});
