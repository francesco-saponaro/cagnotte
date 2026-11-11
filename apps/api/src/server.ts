import { connect, generateSeed, seedDatabase } from "@cagnotte/postgres";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const { db, close } = await connect(config.databaseUrl);
if (config.seedOnStart) {
  await seedDatabase(db, await generateSeed());
  console.log("seed loaded");
}
const app = buildApp({ db, webOrigin: config.webOrigin });
await app.listen({ port: config.port, host: config.host });
console.log(`api listening on http://${config.host}:${config.port}`);

const stop = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
