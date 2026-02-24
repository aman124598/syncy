import { config } from "./config.js";
import { createServer } from "./server.js";

const app = createServer();
app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening at http://${config.host}:${config.port}`);
});
