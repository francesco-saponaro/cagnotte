import { importBody } from "@cagnotte/contracts";
import type { Network } from "@cagnotte/domain";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useImportFile, useImports } from "../api/ops-queries";
import type { ImportBatchRow } from "../api/types";
import { formatDate } from "../ui/format";
import { check, errorsFrom, type FieldErrors } from "../ui/form";
import { useNav } from "../ui/nav";
import { Button, Card, Empty, Failed, Field, Loading, Pager, Pill, Segmented, T, type PillTone } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";

/*
 * "Did the last file go through, and what did it leave for me?" The batches as rows, newest
 * first, each with what it did (new, updated, matched, unmatched, errors); the finding under the
 * title is the latest batch in one sentence. The one action is the import itself: the network,
 * the filename and the file's text, sent as the API wants them.
 */

const NETWORKS: { value: Network; label: string }[] = [
  { value: "linkpool", label: "linkpool" },
  { value: "affinet", label: "affinet" },
];

export const BATCH_TONE: Record<ImportBatchRow["status"], PillTone> = { received: "neutral", processed: "positive", failed: "negative" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Last file: linkpool, 5 new rows, 2 unmatched, 6 lines with errors." */
export function lastFileLine(latest: ImportBatchRow | undefined): string {
  if (!latest) return "No file imported yet.";
  if (latest.status === "failed") return `Last file: ${latest.network}, failed: ${latest.errors[0]?.message ?? "no reason recorded"}.`;
  if (latest.status === "received") return `Last file: ${latest.network}, still being processed.`;
  const parts = [plural(latest.newCount, "new row")];
  if (latest.updatedCount > 0) parts.push(`${latest.updatedCount} updated`);
  if (latest.unmatchedCount > 0) parts.push(`${latest.unmatchedCount} unmatched`);
  if (latest.errorCount > 0) parts.push(`${plural(latest.errorCount, "line")} with errors`);
  return `Last file: ${latest.network}, ${parts.join(", ")}.`;
}

export function ImportsScreen() {
  const nav = useNav();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const imports = useImports(page);
  const latest = page === 1 ? imports.data?.items[0] : undefined;

  return (
    <Screen>
      <TitleRow title="Imports" line={imports.isPending ? "The networks' export files and what each one booked." : page === 1 ? lastFileLine(latest) : `Page ${page} of the files imported.`} action={open ? null : <Button label="Import a file" onPress={() => setOpen(true)} />} />
      {open ? <ImportForm onDone={(batch) => nav.replace(`/imports/${batch.id}`)} onCancel={() => setOpen(false)} /> : null}
      <Card pad={false} style={styles.list}>
        {imports.isPending ? (
          <View style={styles.pad}>
            <Loading rows={4} height={24} />
          </View>
        ) : imports.isError ? (
          <View style={styles.pad}>
            <Failed message={imports.error.message} onRetry={() => void imports.refetch()} />
          </View>
        ) : imports.data.items.length === 0 ? (
          <View style={styles.pad}>
            <Empty>The networks' exports arrive as files: a CSV from linkpool, a JSON document from affinet. Import one and its sales are matched to the members' clicks and booked.</Empty>
          </View>
        ) : (
          imports.data.items.map((b, i) => <BatchLine key={b.id} batch={b} last={i === imports.data.items.length - 1} />)
        )}
      </Card>
      {imports.data ? <Pager page={imports.data.page} pageSize={imports.data.pageSize} total={imports.data.total} count={imports.data.items.length} onPage={setPage} /> : null}
    </Screen>
  );
}

function ImportForm({ onDone, onCancel }: { onDone: (batch: ImportBatchRow) => void; onCancel: () => void }) {
  const wide = useWide();
  const run = useImportFile();
  const [network, setNetwork] = useState<Network>("linkpool");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const checked = check(importBody, { network, filename, content });
    setErrors(checked.errors);
    if (!checked.ok) return;
    run.mutate(checked.data, {
      onSuccess: onDone,
      onError: (error) => {
        const { form, fields } = errorsFrom(error, ["network", "filename", "content"]);
        setErrors(fields);
        setFormError(form);
      },
    });
  };

  return (
    <Card style={styles.form}>
      <T variant="section" role="heading" level={2}>
        Import a file
      </T>
      <T variant="small" style={styles.formLine}>
        Rows the file reports for the first time are matched and booked; rows about orders already known apply their changes. A row that cannot be read is listed by line and skipped.
      </T>
      <View style={[styles.formGrid, wide ? styles.formGridWide : null]}>
        <View style={styles.formField}>
          <T variant="body" weight={500} style={styles.label}>
            Network
          </T>
          <Segmented label="Network" options={NETWORKS} value={network} onChange={setNetwork} />
        </View>
        <View style={[styles.formField, wide ? styles.formFieldGrow : null]}>
          <Field label="Filename" value={filename} onChangeText={setFilename} placeholder="linkpool-transactions-2026-11-16.csv" autoCapitalize="none" autoCorrect={false} error={errors["filename"]} />
        </View>
      </View>
      {Platform.OS === "web" ? (
        <View style={styles.pick}>
          <Button
            label="Choose a file"
            kind="secondary"
            onPress={() =>
              pickFile((name, text) => {
                setFilename(name);
                setContent(text);
                setErrors({});
              })
            }
          />
        </View>
      ) : null}
      <Field label="File contents" value={content} onChangeText={setContent} multiline placeholder={network === "linkpool" ? "transaction_id,advertiser_id,click_ref,order_ref,transaction_date,sale_amount,commission_amount,status,last_updated" : '{ "network": "affinet", "transactions": [ … ] }'} autoCapitalize="none" autoCorrect={false} error={errors["content"]} hint="Paste the export, or choose the file above." />
      {formError ? (
        <View role="alert" style={styles.alert}>
          <T variant="body" style={{ color: colors.negative }}>
            {formError}
          </T>
        </View>
      ) : null}
      <View style={styles.formActions}>
        <Button label="Run the import" onPress={submit} busy={run.isPending} />
        <Button label="Cancel" kind="text" onPress={onCancel} />
      </View>
    </Card>
  );
}

/** The browser's file dialog, read as text into the form; the file never leaves the page until the import is sent. */
function pickFile(onFile: (name: string, text: string) => void): void {
  if (typeof document === "undefined") return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,.json,text/csv,application/json,text/plain";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => onFile(file.name, text));
  };
  input.click();
}

function BatchLine({ batch, last }: { batch: ImportBatchRow; last: boolean }) {
  const { Link } = useNav();
  const wide = useWide();
  const counts = `${batch.newCount} new · ${batch.updatedCount} updated · ${batch.matchedCount} matched · ${batch.unmatchedCount} unmatched · ${batch.errorCount} ${batch.errorCount === 1 ? "error" : "errors"}`;
  return (
    <Link href={`/imports/${batch.id}`} aria-label={`${batch.network}, ${batch.filename}, ${batch.status}`} style={[styles.line, last ? null : styles.rule]}>
      <View style={styles.lineInner}>
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {batch.filename}
          </T>
          <T variant="small" numberOfLines={1}>
            {batch.network} · {formatDate(batch.createdAt)}
            {wide ? "" : ` · ${counts}`}
          </T>
        </View>
        {wide ? (
          <View style={styles.lineCounts} aria-label="Counts">
            <Count label="rows" value={batch.rowCount} />
            <Count label="new" value={batch.newCount} />
            <Count label="updated" value={batch.updatedCount} />
            <Count label="matched" value={batch.matchedCount} />
            <Count label="unmatched" value={batch.unmatchedCount} />
            <Count label="errors" value={batch.errorCount} />
          </View>
        ) : null}
        <View style={styles.lineRight}>
          <Pill tone={BATCH_TONE[batch.status]}>{batch.status}</Pill>
        </View>
      </View>
    </Link>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.count}>
      <T variant="body" num align="right">
        {value}
      </T>
      <T variant="small" align="right">
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { overflow: "hidden" },
  pad: { padding: space.card },
  form: { marginBottom: space.pad },
  formLine: { marginTop: 6, marginBottom: 20 },
  formGrid: { gap: 0 },
  formGridWide: { flexDirection: "row", gap: space.pad, alignItems: "flex-start" },
  formField: { marginBottom: 0 },
  formFieldGrow: { flex: 1 },
  label: { marginBottom: 8 },
  pick: { flexDirection: "row", marginBottom: 16 },
  alert: { marginBottom: 12 },
  formActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  line: { minHeight: 64, justifyContent: "center", paddingHorizontal: space.card },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  lineInner: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  lineText: { flex: 1, minWidth: 0 },
  lineCounts: { flexDirection: "row", gap: 20, marginLeft: 16 },
  count: { minWidth: 56, alignItems: "flex-end" },
  lineRight: { marginLeft: 20, minWidth: 80, alignItems: "flex-end" },
});
