import { createApp } from "./app";

const port = parseInt(process.env.PORT ?? "4000", 10);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[fixture-a backend] listening on http://localhost:${port}`);
});
