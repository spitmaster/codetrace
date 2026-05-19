import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `/data/<file>` is wired to `../reports/<dir>/<file>` so the React app
 * can fetch the four JSON artefacts emitted by the CLI without copying
 * them into web/public/ (which would cause stale-data bugs every time
 * `npm run e2e:m1` regenerates them).
 *
 * Data source selection:
 *   - Default: `../reports/m1-out/` (matches `npm run e2e:m1` mock provider).
 *   - Override via `CODETRACE_DATA_DIR` env var, either an absolute path or a
 *     path relative to the repo root. Set by `scripts/start.ps1` when the
 *     user picks a non-mock provider, e.g. claude-code → `reports/m1-out-claude-code`.
 *
 * In a packaged release (`codeviz view <output.json>`, SPEC §6), this dev
 * server is replaced by a tiny static server in cli/; the URL convention
 * stays identical so the same web bundle works in both modes.
 */
function dataAlias(): Plugin {
  const repoRoot = resolve(__dirname, "..");
  const envDir = process.env.CODETRACE_DATA_DIR;
  const reportsDir = envDir
    ? (envDir.match(/^([a-zA-Z]:|\/|\\)/) ? resolve(envDir) : resolve(repoRoot, envDir))
    : resolve(repoRoot, "reports/m1-out");
  // eslint-disable-next-line no-console
  console.log(`[codeviz] /data → ${reportsDir}`);
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
      // Allow access to repo root + web/. When CODETRACE_DATA_DIR points
      // outside the repo (rare, but supported for absolute paths), include
      // that directory too so vite doesn't 403 the read.
      allow: [
        resolve(__dirname, ".."),
        resolve(__dirname),
        ...(process.env.CODETRACE_DATA_DIR
          ? [
              (process.env.CODETRACE_DATA_DIR.match(/^([a-zA-Z]:|\/|\\)/)
                ? resolve(process.env.CODETRACE_DATA_DIR)
                : resolve(__dirname, "..", process.env.CODETRACE_DATA_DIR)),
            ]
          : []),
      ],
    },
  },
});
