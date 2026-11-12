import { describePorts } from "../../domain/test/port-contract.js";
import { connectPglite, drizzlePortsCreator } from "../src/index.js";

describePorts("drizzle on PGlite", async () => {
  const { db, close } = await connectPglite();
  const { ports, unitOfWork } = drizzlePortsCreator(db);
  return { ports, unitOfWork, close };
});
