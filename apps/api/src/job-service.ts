import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AnalysisResult, JobRecord, TimeRange } from "@syncy/shared";
import { AppError } from "./errors.js";
import { JobRepository } from "./db.js";
import { JobEventBus } from "./events.js";
import { appendJobLog } from "./logger.js";
import { probeDurationSeconds } from "./media.js";
import { JobQueue } from "./queue.js";
import { runAnalysis } from "./analysis.js";
import { computeTrimDecision } from "./decision/engine.js";
import { renderVideo } from "./render.js";
import { paths } from "./config.js";
import { validateOverrideRange } from "./override.js";

type UploadInput = {
  videoOriginalName: string;
  videoBuffer: Buffer;
  replacementAudioOriginalName?: string;
  replacementAudioBuffer?: Buffer;
};

function sanitizeExt(fileName: string | undefined, fallback: string): string {
  if (!fileName) {
    return fallback;
  }
  const ext = path.extname(fileName).toLowerCase();
  if (!ext || ext.length > 10) {
    return fallback;
  }
  return ext.replace(/[^a-z0-9.]/g, "") || fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class JobService {
  public constructor(
    private readonly repo: JobRepository,
    private readonly bus: JobEventBus,
    private readonly queue: JobQueue
  ) {}

  public async createJob(input: UploadInput): Promise<JobRecord> {
    const jobId = uuidv4();
    const uploadDir = path.join(paths.uploadsRoot, jobId);
    const workDir = path.join(paths.workRoot, jobId);
    const artifactDir = path.join(paths.artifactsRoot, jobId);
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(artifactDir, { recursive: true });

    const videoPath = path.join(uploadDir, `video${sanitizeExt(input.videoOriginalName, ".mp4")}`);
    fs.writeFileSync(videoPath, input.videoBuffer);

    let replacementAudioPath: string | undefined;
    if (input.replacementAudioBuffer && input.replacementAudioOriginalName) {
      replacementAudioPath = path.join(
        uploadDir,
        `replacement-audio${sanitizeExt(input.replacementAudioOriginalName, ".wav")}`
      );
      fs.writeFileSync(replacementAudioPath, input.replacementAudioBuffer);
    }

    const videoDurationSec = await probeDurationSeconds(videoPath);
    const targetDurationSec = replacementAudioPath
      ? await probeDurationSeconds(replacementAudioPath)
      : videoDurationSec;
    const deltaSec = videoDurationSec - targetDurationSec;

    const createdAt = nowIso();
    let job = this.repo.insertJob({
      id: jobId,
      status: "queued",
      videoPath,
      replacementAudioPath,
      videoDurationSec,
      targetDurationSec,
      deltaSec,
      createdAt,
      updatedAt: createdAt
    });
    this.emitAndPersistEvent(jobId, "status", {
      status: "queued",
      message: "Job accepted and queued."
    });

    if (replacementAudioPath && deltaSec <= 0) {
      job = this.repo.updateJob(jobId, {
        status: "failed",
        errorCode: "AUDIO_LONGER_THAN_VIDEO",
        errorMessage:
          "Replacement audio is longer than the source video. V1 only supports trimming excess video."
      });
      this.emitAndPersistEvent(jobId, "error", {
        message: job.errorMessage,
        code: "AUDIO_LONGER_THAN_VIDEO"
      });
      return job;
    }

    this.queue.push(async () => {
      await this.processAnalysis(jobId);
    });

    return job;
  }

  private emitAndPersistEvent(jobId: string, type: string, payload: Record<string, unknown>): void {
    this.repo.insertEvent(jobId, type, payload);
    this.bus.publish(jobId, {
      type:
        type === "status" ||
        type === "progress" ||
        type === "log" ||
        type === "error" ||
        type === "complete"
          ? type
          : "log",
      timestamp: new Date().toISOString(),
      ...(payload as unknown as Record<string, string | number>)
    });
  }

  private mapError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }
    if (error instanceof Error) {
      return new AppError("ANALYSIS_FAILED", error.message, 500);
    }
    return new AppError("ANALYSIS_FAILED", String(error), 500);
  }

  private async processAnalysis(jobId: string): Promise<void> {
    const job = this.repo.getJob(jobId);
    if (!job || job.status === "failed") {
      return;
    }

    this.repo.updateJob(jobId, { status: "analyzing" });
    this.emitAndPersistEvent(jobId, "status", {
      status: "analyzing",
      message: "Running AI analysis."
    });
    appendJobLog(jobId, "info", "AI analysis started.");

    try {
      const workDir = path.join(paths.workRoot, jobId);
      const analysisPath = path.join(workDir, "analysis.json");
      const analysisResult = await runAnalysis({
        videoPath: job.videoPath,
        workDir,
        outputPath: analysisPath,
        onLog: (line) => {
          if (!line) {
            return;
          }
          appendJobLog(jobId, "info", line);
          this.emitAndPersistEvent(jobId, "log", { message: line });
        }
      });

      const decision = computeTrimDecision({
        videoDurationSec: job.videoDurationSec,
        targetDurationSec: job.targetDurationSec,
        analysis: analysisResult,
        hasReplacementAudio: Boolean(job.replacementAudioPath)
      });

      const updated = this.repo.updateJob(jobId, {
        status: "awaiting_review",
        analysisResult,
        decision,
        errorCode: undefined,
        errorMessage: undefined
      });
      this.emitAndPersistEvent(jobId, "status", {
        status: "awaiting_review",
        message: "Trim suggestion is ready for review."
      });
      this.repo.upsertArtifact(jobId, "analysis", analysisPath, {
        warnings: analysisResult.warnings
      });
      appendJobLog(jobId, "info", "AI analysis completed.");
      this.bus.emitStatus(jobId, updated.status, "Awaiting manual review.");
    } catch (error) {
      const mapped = this.mapError(error);
      this.repo.updateJob(jobId, {
        status: "failed",
        errorCode: mapped.code,
        errorMessage: mapped.message
      });
      appendJobLog(jobId, "error", mapped.message);
      this.emitAndPersistEvent(jobId, "error", {
        code: mapped.code,
        message: mapped.message
      });
    }
  }

  public getJob(jobId: string): JobRecord | null {
    return this.repo.getJob(jobId);
  }

  public listEvents(jobId: string): ReturnType<JobRepository["listEvents"]> {
    return this.repo.listEvents(jobId);
  }

  public saveOverride(jobId: string, keepRange: TimeRange): JobRecord {
    const job = this.repo.getJob(jobId);
    if (!job) {
      throw new AppError("JOB_NOT_FOUND", `Job ${jobId} not found.`, 404);
    }
    validateOverrideRange(job, keepRange);
    const updated = this.repo.updateJob(jobId, { overrideKeepRange: keepRange });
    this.emitAndPersistEvent(jobId, "log", {
      message: `Manual override set: ${keepRange.startSec.toFixed(2)}-${keepRange.endSec.toFixed(2)}s`
    });
    return updated;
  }

  public async render(jobId: string): Promise<JobRecord> {
    const job = this.repo.getJob(jobId);
    if (!job) {
      throw new AppError("JOB_NOT_FOUND", `Job ${jobId} not found.`, 404);
    }
    if (!job.decision && !job.overrideKeepRange) {
      throw new AppError("INVALID_OVERRIDE_RANGE", "No trim decision is available to render.");
    }

    const keepRange = job.overrideKeepRange ?? job.decision!.keepRange;
    validateOverrideRange(job, keepRange);
    this.repo.updateJob(jobId, { status: "rendering" });
    this.emitAndPersistEvent(jobId, "status", {
      status: "rendering",
      message: "Rendering video output."
    });

    const outputPath = path.join(paths.outputsRoot, `${jobId}.mp4`);
    try {
      const result = await renderVideo({
        videoPath: job.videoPath,
        replacementAudioPath: job.replacementAudioPath,
        keepRange,
        videoDurationSec: job.videoDurationSec,
        targetDurationSec: job.targetDurationSec,
        outputPath,
        onProgress: (progress, message) => {
          this.emitAndPersistEvent(jobId, "progress", { progress, message });
        },
        onLog: (message) => {
          if (message) {
            appendJobLog(jobId, "info", message);
          }
        }
      });

      this.repo.upsertArtifact(jobId, "output", outputPath, { durationSec: result.durationSec });
      const completed = this.repo.updateJob(jobId, {
        status: "completed",
        outputPath,
        errorCode: undefined,
        errorMessage: undefined
      });
      this.emitAndPersistEvent(jobId, "complete", { message: "Render completed." });
      return completed;
    } catch (error) {
      const mapped = error instanceof AppError ? error : this.mapError(error);
      const failed = this.repo.updateJob(jobId, {
        status: "failed",
        errorCode: mapped.code,
        errorMessage: mapped.message
      });
      appendJobLog(jobId, "error", mapped.message);
      this.emitAndPersistEvent(jobId, "error", {
        code: mapped.code,
        message: mapped.message
      });
      return failed;
    }
  }

  public toResponse(job: JobRecord): Record<string, unknown> {
    const base = {
      ...job,
      videoUrl: `/media/uploads/${job.id}/${path.basename(job.videoPath)}`,
      replacementAudioUrl: job.replacementAudioPath
        ? `/media/uploads/${job.id}/${path.basename(job.replacementAudioPath)}`
        : undefined,
      outputUrl: job.outputPath ? `/media/outputs/${path.basename(job.outputPath)}` : undefined
    };
    return base;
  }
}
