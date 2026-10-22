import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, SVNX_DEV_URL: "http://127.0.0.1:5173" },
  windowsHide: true,
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
