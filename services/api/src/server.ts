import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDeps } from "./deps.ts";

const config = loadConfig();
const app = await buildApp(config, createDeps(config));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    app.close().then(() => process.exit(0), () => process.exit(1));
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
