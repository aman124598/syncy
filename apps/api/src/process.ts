import { spawn } from "node:child_process";

export type ProcessRunOptions = {
  cwd?: string;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
};

export type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export async function runProcess(
  command: string,
  args: string[],
  options: ProcessRunOptions = {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}
