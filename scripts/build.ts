import { copyFile, mkdir } from "node:fs/promises";

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`${cmd.join(" ")} failed with exit code ${code}`);
    process.exit(code);
  }
}

await mkdir("dist/panel", { recursive: true });
await run(["bunx", "openchamber-guest-bundle", "src/panel/main.ts", "dist/panel/main.js"]);
await copyFile("src/panel/index.html", "dist/panel/index.html");
await mkdir("dist/status", { recursive: true });
await run(["bunx", "openchamber-guest-bundle", "src/status/main.ts", "dist/status/main.js"]);
await copyFile("src/status/index.html", "dist/status/index.html");
await mkdir("dist/service", { recursive: true });
await run(["bunx", "openchamber-guest-bundle", "--node", "src/service/main.ts", "dist/service/main.js"]);
await run(["bunx", "openchamber-guest-check"]);
