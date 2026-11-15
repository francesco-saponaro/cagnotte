import { signInBody } from "@cagnotte/contracts";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSignIn } from "../api/queries";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, homeFor } from "../auth/home";
import { Wordmark } from "../ui/wordmark";
import { check, errorsFrom, type FieldErrors } from "../ui/form";
import { useNav } from "../ui/nav";
import { Button, Card, Field, T } from "../ui/primitives";
import { Screen, useWide } from "../ui/screen";
import { BUCKETS } from "../ui/bucket-strip";
import { colors, font, radius, size } from "../ui/tokens";

/*
 * Email and password against the API. The three demo accounts sit under the form so a visitor can
 * open the app as a member, an agent or a manager in one tap.
 */

const STEPS: { title: string; text: string }[] = [
  { title: "Activate, then buy", text: "Open an offer, tap Activate, and buy on the shop's site as usual. The rate you saw is locked on that click." },
  { title: "Watch it move", text: "The shop reports the order within days; the cashback sits as pending until the return period ends, then it is yours." },
  { title: "Pay it out", text: "A bank transfer from 20 €, a gift card from 15 €, or a donation from 5 €. Something missing? File a claim with the order details." },
];

export function SignInScreen() {
  const nav = useNav();
  const wide = useWide();
  const signIn = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const checked = check(signInBody, { email, password });
    setErrors(checked.errors);
    if (!checked.ok) return;
    signIn.mutate(checked.data, {
      onSuccess: ({ user }) => nav.replace(homeFor(user.role)),
      onError: (error) => {
        const { form, fields } = errorsFrom(error, ["email", "password"]);
        setErrors(fields);
        setFormError(form);
      },
    });
  };

  return (
    <Screen>
      <View style={[styles.wrap, wide ? styles.wrapWide : null]}>
        <View style={[styles.intro, wide ? styles.introWide : null]}>
          <Wordmark size="large" />
          <T variant="body" muted style={styles.tagline}>
            Cashback on the shops you already use, in a pot you can pay out.
          </T>
          {wide ? (
            <View style={styles.steps}>
              {STEPS.map((step) => (
                <View key={step.title} style={styles.step}>
                  <T variant="section" role="heading" level={2}>
                    {step.title}
                  </T>
                  <T variant="body" style={styles.stepText}>
                    {step.text}
                  </T>
                </View>
              ))}
              <View style={styles.buckets}>
                <T variant="small">The pot has four places money can be</T>
                <View style={styles.bucketRow}>
                  {BUCKETS.map((b) => (
                    <View key={b.key} style={styles.bucket}>
                      <View style={[styles.swatch, { backgroundColor: b.color }]} />
                      <T variant="body">{b.label}</T>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : null}
        </View>
        <Card style={[styles.card, wide ? styles.cardWide : null]}>
          <T variant="title" role="heading" level={1} style={styles.title}>
            Sign in
          </T>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" error={errors.email ?? null} onSubmitEditing={submit} />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" error={errors.password ?? null} onSubmitEditing={submit} />
          {formError ? (
            <View role="alert" style={styles.alert}>
              <T variant="body" style={{ color: colors.negative }}>
                {formError}
              </T>
            </View>
          ) : null}
          <Button label="Sign in" onPress={submit} busy={signIn.isPending} style={styles.submit} />
          <T variant="small" style={styles.demoTitle}>
            Demo accounts, password {DEMO_PASSWORD}
          </T>
          <View style={styles.demoRow}>
            {DEMO_ACCOUNTS.map((account) => (
              <Pressable
                key={account.email}
                role="button"
                aria-label={`${account.name}, ${account.role}`}
                onPress={() => {
                  setEmail(account.email);
                  setPassword(DEMO_PASSWORD);
                  setErrors({});
                  setFormError(null);
                }}
                style={({ pressed }) => [styles.demo, pressed ? styles.demoPressed : null]}
              >
                <Text style={[styles.demoName, font(500)]}>{account.name}</Text>
                <Text style={[styles.demoRole, font(400)]}>{account.role}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 420, alignSelf: "center", paddingTop: 48 },
  wrapWide: { maxWidth: 1088, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingTop: 72, gap: 48 },
  intro: { marginBottom: 24 },
  introWide: { flex: 1, maxWidth: 560, marginBottom: 0 },
  tagline: { marginTop: 12 },
  steps: { marginTop: 40, gap: 24 },
  step: {},
  stepText: { marginTop: 6, maxWidth: 480 },
  buckets: { marginTop: 8 },
  bucketRow: { flexDirection: "row", flexWrap: "wrap", gap: 20, marginTop: 10 },
  bucket: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  card: { padding: 24 },
  cardWide: { width: 420 },
  title: { marginBottom: 20 },
  alert: { marginBottom: 12 },
  submit: { marginTop: 4 },
  demoTitle: { marginTop: 28, marginBottom: 10 },
  demoRow: { flexDirection: "row", gap: 8 },
  demo: { flex: 1, height: 52, borderRadius: radius.control, backgroundColor: colors.raised, alignItems: "flex-start", justifyContent: "center", paddingHorizontal: 12 },
  demoPressed: { backgroundColor: colors.active },
  demoName: { fontSize: size.body, lineHeight: 18, color: colors.text },
  demoRole: { fontSize: size.small, lineHeight: 16, color: colors.muted },
});
