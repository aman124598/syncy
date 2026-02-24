import type { Response } from "express";
import type { JobEvent, JobStatus } from "@syncy/shared";

function sseWrite(res: Response, event: JobEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export class JobEventBus {
  private readonly clients = new Map<string, Set<Response>>();

  public addClient(jobId: string, res: Response): void {
    if (!this.clients.has(jobId)) {
      this.clients.set(jobId, new Set<Response>());
    }
    this.clients.get(jobId)?.add(res);
  }

  public removeClient(jobId: string, res: Response): void {
    const set = this.clients.get(jobId);
    if (!set) {
      return;
    }
    set.delete(res);
    if (set.size === 0) {
      this.clients.delete(jobId);
    }
  }

  public publish(jobId: string, event: JobEvent): void {
    const set = this.clients.get(jobId);
    if (!set) {
      return;
    }
    for (const res of set) {
      sseWrite(res, event);
    }
  }

  public emitStatus(jobId: string, status: JobStatus, message?: string): void {
    this.publish(jobId, {
      type: "status",
      status,
      message,
      timestamp: new Date().toISOString()
    });
  }

  public emitProgress(jobId: string, progress: number, message?: string): void {
    this.publish(jobId, {
      type: "progress",
      progress: Math.min(1, Math.max(0, progress)),
      message,
      timestamp: new Date().toISOString()
    });
  }

  public emitError(jobId: string, message: string): void {
    this.publish(jobId, {
      type: "error",
      message,
      timestamp: new Date().toISOString()
    });
  }

  public emitComplete(jobId: string, message?: string): void {
    this.publish(jobId, {
      type: "complete",
      message,
      timestamp: new Date().toISOString()
    });
  }
}
