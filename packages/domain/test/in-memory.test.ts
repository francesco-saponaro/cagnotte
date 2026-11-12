import { inMemoryPortsCreator } from "../src/index.js";
import { describePorts } from "./port-contract.js";

describePorts("in-memory", async () => {
  const { ports, unitOfWork } = inMemoryPortsCreator();
  return { ports, unitOfWork, close: async () => {} };
});
