import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";

export function appendJobLog(jobId: string, level: "info" | "error", message: string): void {
  const jobArtifactsDir = path.join(paths.artifactsRoot, jobId);
  fs.mkdirSync(jobArtifactsDir, { recursive: true });
  const filePath = path.join(jobArtifactsDir, "logs.jsonl");
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message
  });
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
}
