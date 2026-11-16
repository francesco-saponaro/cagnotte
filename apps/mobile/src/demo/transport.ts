import { cryptoIdGeneratorCreator, systemClock, useCasesCreator, type Clock, type IdGenerator } from "@cagnotte/domain";
import { dispatcherCreator, errorBody, routesCreator, type Dispatch } from "@cagnotte/handlers";
import { drizzlePortsCreator } from "@cagnotte/postgres/adapters";
import type { Db } from "@cagnotte/postgres/db";
import type { Transport } from "../api/transport";

/*
 * The transport of demo mode: the API's route table dispatched on the use cases over a database
 * that lives in the page. It is the server's composition root without the server, so a request
 * from a screen gets the same status and the same body it would get over HTTP. The database is
 * opened on the first request and kept; opening is the caller's (`database.ts` in the browser,
 * PGlite in the test process).
 */

export interface DemoOptions {
  clock?: Clock;
  ids?: IdGenerator;
  sessionHours?: number;
}

export function demoTransportCreator(open: () => Promise<Db>, options: DemoOptions = {}): Transport {
  let dispatch: Promise<Dispatch> | null = null;

  const start = async (): Promise<Dispatch> => {
    const db = await open();
    const { ports, unitOfWork } = drizzlePortsCreator(db);
    const useCases = useCasesCreator({ ports, unitOfWork, clock: options.clock ?? systemClock, ids: options.ids ?? cryptoIdGeneratorCreator(), sessionHours: options.sessionHours ?? 72 });
    return dispatcherCreator(routesCreator(useCases), useCases);
  };

  return {
    async request({ method, path, query, body, token }) {
      if (method === "DELETE") return { status: 404, body: errorBody("not_found", "no such route") };
      let run: Dispatch;
      try {
        dispatch ??= start();
        run = await dispatch;
      } catch (error) {
        // The next request tries again: a failed download is not a dead demo.
        dispatch = null;
        return { status: 500, body: errorBody("internal", `the demo database could not be opened: ${error instanceof Error ? error.message : String(error)}`) };
      }
      try {
        const response = await run({ method, path, query, body, token });
        // What the screens get is what the wire would carry: a Date is an ISO string, undefined is gone.
        return { status: response.status, body: response.body === undefined ? undefined : JSON.parse(JSON.stringify(response.body)) };
      } catch (error) {
        return { status: 500, body: errorBody("internal", error instanceof Error ? error.message : "something went wrong in the demo") };
      }
    },
  };
}
