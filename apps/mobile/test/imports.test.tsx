import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImportBatchScreen } from "@/screens/import-batch";
import { ImportsScreen } from "@/screens/imports";
import { batchFailed, batchProcessed, nadia, txMatched, txUnmatched } from "./ops-fixtures";
import { page, refuse, renderApp, signedIn } from "./harness";

describe("the imports", () => {
  it("lists the batches with their counts and status, newest first as the server sends them", async () => {
    const { nav } = await renderApp(<ImportsScreen />, { session: await signedIn(nadia), routes: { "GET /imports": () => page([batchFailed, batchProcessed]) } });
    expect(await screen.findByText(/linkpool-transactions-2026-11-13.csv/)).toBeInTheDocument();
    expect(screen.getByText("processed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/Last file: affinet, failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /linkpool-transactions-2026-11-13.csv/ }));
    expect(nav.pushed).toEqual(["/imports/imp_1"]);
  });

  it("says the latest file's outcome under the title", async () => {
    await renderApp(<ImportsScreen />, { session: await signedIn(nadia), routes: { "GET /imports": () => page([batchProcessed]) } });
    expect(await screen.findByText("Last file: linkpool, 5 new rows, 2 unmatched, 6 lines with errors.")).toBeInTheDocument();
  });

  it("says so when no file has been imported", async () => {
    await renderApp(<ImportsScreen />, { session: await signedIn(nadia), routes: { "GET /imports": () => page([]) } });
    expect(await screen.findByText("No file imported yet.")).toBeInTheDocument();
    expect(screen.getByText(/The networks' exports/)).toBeInTheDocument();
  });

  it("refuses an empty file before sending, with the schema's words", async () => {
    const { api } = await renderApp(<ImportsScreen />, { session: await signedIn(nadia), routes: { "GET /imports": () => page([]) } });
    fireEvent.click(await screen.findByRole("button", { name: "Import a file" }));
    fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "linkpool-2026-11-16.csv" } });
    fireEvent.click(screen.getByRole("button", { name: "Run the import" }));
    expect(await screen.findByText("the file is empty")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("posts the network, the filename and the file's text, then opens the batch", async () => {
    const { api, nav } = await renderApp(<ImportsScreen />, { session: await signedIn(nadia), routes: { "GET /imports": () => page([]), "POST /imports": () => ({ ...batchProcessed, id: "imp_new" }) } });
    fireEvent.click(await screen.findByRole("button", { name: "Import a file" }));
    fireEvent.click(screen.getByRole("radio", { name: "affinet" }));
    fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "affinet-2026-11-16.json" } });
    fireEvent.change(screen.getByLabelText("File contents"), { target: { value: '{"transactions":[]}' } });
    fireEvent.click(screen.getByRole("button", { name: "Run the import" }));
    await waitFor(() => expect(nav.replaced).toEqual(["/imports/imp_new"]));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ network: "affinet", filename: "affinet-2026-11-16.json", content: '{"transactions":[]}' });
  });

  it("shows the API's refusal in its own words", async () => {
    await renderApp(<ImportsScreen />, { session: await signedIn(nadia), routes: { "GET /imports": () => page([]), "POST /imports": () => refuse(422, "rule", "no merchant answers to advertiser LP-nobody") } });
    fireEvent.click(await screen.findByRole("button", { name: "Import a file" }));
    fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "big.csv" } });
    fireEvent.change(screen.getByLabelText("File contents"), { target: { value: "a,b,c" } });
    fireEvent.click(screen.getByRole("button", { name: "Run the import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no merchant answers to advertiser LP-nobody");
  });
});

describe("one batch", () => {
  it("shows the counts, the errors by line and the batch's transactions", async () => {
    const { nav } = await renderApp(<ImportBatchScreen id="imp_1" />, {
      session: await signedIn(nadia),
      routes: { "GET /imports/:id": () => batchProcessed, "GET /transactions": ({ query }) => (query["batch"] === "imp_1" ? page([txMatched, txUnmatched]) : page([])) },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "linkpool-transactions-2026-11-13.csv" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rows").textContent).toContain("11");
    expect(screen.getByLabelText("Unmatched").textContent).toContain("2");
    expect(screen.getByText(/line 6: sale_amount is not an amount: 12.9O/)).toBeInTheDocument();
    expect(screen.getByText(/line 11: LP-DUP appears twice/)).toBeInTheDocument();
    expect(await screen.findByText(/ORD-77300/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /ORD-77213/ }));
    expect(nav.pushed).toEqual(["/transactions/ntx_unmatched"]);
  });

  it("shows a failed batch's one reason and no transactions", async () => {
    await renderApp(<ImportBatchScreen id="imp_2" />, { session: await signedIn(nadia), routes: { "GET /imports/:id": () => batchFailed, "GET /transactions": () => page([]) } });
    expect(await screen.findByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/the file is not a JSON document/)).toBeInTheDocument();
    expect(await screen.findByText(/Nothing was booked from this file/)).toBeInTheDocument();
  });
});
