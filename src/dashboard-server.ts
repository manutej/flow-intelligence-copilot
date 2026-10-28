import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import askHandler from "../api/ask.js";
import stateHandler from "../api/state.js";
import workflowHandler from "../api/workflow.js";
import swarmHandler from "../api/swarm.js";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

export function createDashboardServer(repoRootDir?: string): http.Server {
  const repoRoot = path.resolve(
    repoRootDir ?? new URL("..", import.meta.url).pathname,
  );

  return http.createServer(async (req, res) => {
    const rawUrl = req.url ?? "/";
    const urlObj = new URL(rawUrl, "http://localhost");
    const pathname = urlObj.pathname;

    if (pathname === "/api/ask") {
      await askHandler(req, res);
      return;
    }

    if (pathname === "/api/state") {
      await stateHandler(req, res);
      return;
    }

    if (pathname === "/api/workflow") {
      await workflowHandler(req, res);
      return;
    }

    if (pathname === "/api/swarm") {
      await swarmHandler(req, res);
      return;
    }

    let targetFile = path.join(repoRoot, "public", "index.html");
    if (pathname === "/" || pathname === "/index.html") {
      targetFile = path.join(repoRoot, "public", "index.html");
    } else if (pathname === "/field-notebook.html") {
      const pubNb = path.join(repoRoot, "public", "field-notebook.html");
      targetFile = fs.existsSync(pubNb)
        ? pubNb
        : path.join(repoRoot, "ui", "flowiq-visual-studio.html");
    } else if (pathname === "/AGENTS.md") {
      targetFile = path.join(repoRoot, "AGENTS.md");
    } else if (pathname === "/llms.txt") {
      const pubLlms = path.join(repoRoot, "public", "llms.txt");
      targetFile = fs.existsSync(pubLlms)
        ? pubLlms
        : path.join(repoRoot, "llms.txt");
    } else if (pathname === "/ui/flowiq-visual-studio.html") {
      targetFile = path.join(repoRoot, "ui", "flowiq-visual-studio.html");
    } else if (pathname.startsWith("/docs/assets/")) {
      const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      targetFile = path.join(repoRoot, safeRel);
    } else if (pathname.startsWith("/reports/")) {
      const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      targetFile = path.join(repoRoot, safeRel);
    } else {
      const safeRel = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      const candidatePublic = path.join(repoRoot, "public", safeRel);
      if (
        fs.existsSync(candidatePublic) &&
        fs.statSync(candidatePublic).isFile()
      ) {
        targetFile = candidatePublic;
      }
    }

    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: `Not found: ${pathname}` }));
      return;
    }

    const ext = path.extname(targetFile).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.end(fs.readFileSync(targetFile));
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? "4310", 10);
  const server = createDashboardServer();
  server.listen(port, () => {
    console.log(
      `FlowIQ Ormus Chrome Dashboard running at http://localhost:${port}`,
    );
    console.log(
      `API endpoints ready: POST /api/ask · GET /api/state · GET /api/workflow · GET/POST /api/swarm · GET /llms.txt · GET /AGENTS.md`,
    );
  });
}
