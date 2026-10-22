import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: false },
});
await server.listen();
const devUrl = new URL(server.resolvedUrls.local[0]).origin;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, SVNX_DEV_URL: devUrl },
  windowsHide: false,
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
