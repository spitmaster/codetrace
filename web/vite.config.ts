import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `/data/<file>` is wired to `../reports/m1-out/<file>` so the React app
 * can fetch the four JSON artefacts emitted by the CLI without copying
 * them into web/public/ (which would cause stale-data bugs every time
 * `npm run e2e:m1` regenerates them).
 *
 * In a packaged release (`codeviz view <output.json>`, SPEC §6), this dev
 * server is replaced by a tiny static server in cli/; the URL convention
 * stays identical so the same web bundle works in both modes.
 */
function dataAlias(): Plugin {
  const reportsDir = resolve(__dirname, "../reports/m1-out");
  return {
    name: "codeviz-data-alias",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const url = (req.url ?? "/").split("?")[0];
        const fp = resolve(reportsDir, "." + url);
        if (!fp.startsWith(reportsDir)) {
          res.statusCode = 403;
          res.end("forbidden");
          return;
        }
        if (!existsSync(fp)) {
          res.statusCode = 404;
          res.end(`not found: ${url}`);
          return;
        }
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(readFileSync(fp));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), dataAlias()],
  server: {
    port: 5174,
    fs: {
      allow: [resolve(__dirname, ".."), resolve(__dirname)],
    },
  },
});
