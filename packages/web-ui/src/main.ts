import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(`agent-land web UI listening on port ${config.port}`);
  console.log(`engine: ${config.engineUrl}`);
});