import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import { overridePayloadSchema } from "@syncy/shared";
import { config, paths } from "./config.js";
import { JobRepository } from "./db.js";
import { JobEventBus } from "./events.js";
import { AppError } from "./errors.js";
import { JobQueue } from "./queue.js";
import { runPreflight } from "./preflight.js";
import { JobService } from "./job-service.js";

const repository = new JobRepository(paths.dbPath);
const eventBus = new JobEventBus();
const queue = new JobQueue(config.jobConcurrency);
const jobService = new JobService(repository, eventBus, queue);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadMb * 1024 * 1024
  }
});

export function createServer(): express.Express {
  const app = express();

  app.use(cors({ origin: `http://${config.host}:${config.webPort}` }));
  app.use(express.json({ limit: "2mb" }));

  app.use("/media/uploads", express.static(paths.uploadsRoot));
  app.use("/media/outputs", express.static(paths.outputsRoot));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get("/api/preflight", async (_req, res, next) => {
    try {
      const result = await runPreflight();
      res.status(result.ok ? 200 : 503).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/jobs",
    upload.fields([
      { name: "video", maxCount: 1 },
      { name: "replacementAudio", maxCount: 1 }
    ]),
    async (req, res, next) => {
      try {
        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const videoFile = files?.video?.[0];
        if (!videoFile) {
          throw new AppError("INVALID_OVERRIDE_RANGE", "A video file is required.", 400);
        }
        const replacementAudioFile = files?.replacementAudio?.[0];
        const job = await jobService.createJob({
          videoOriginalName: videoFile.originalname,
          videoBuffer: videoFile.buffer,
          replacementAudioOriginalName: replacementAudioFile?.originalname,
          replacementAudioBuffer: replacementAudioFile?.buffer
        });
        res.status(202).json(jobService.toResponse(job));
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/jobs/:id", (req, res) => {
    const job = jobService.getJob(req.params.id);
    if (!job) {
      res.status(404).json({
        code: "JOB_NOT_FOUND",
        message: `Job ${req.params.id} not found.`
      });
      return;
    }
    res.json(jobService.toResponse(job));
  });

  app.get("/api/jobs/:id/events", (req, res) => {
    const job = jobService.getJob(req.params.id);
    if (!job) {
      res.status(404).json({
        code: "JOB_NOT_FOUND",
        message: `Job ${req.params.id} not found.`
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.flushHeaders();
    eventBus.addClient(req.params.id, res);

    for (const row of jobService.listEvents(req.params.id)) {
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      res.write(
        `data: ${JSON.stringify({
          type:
            row.type === "status" ||
            row.type === "progress" ||
            row.type === "log" ||
            row.type === "error" ||
            row.type === "complete"
              ? row.type
              : "log",
          timestamp: row.timestamp,
          ...payload
        })}\n\n`
      );
    }

    req.on("close", () => {
      eventBus.removeClient(req.params.id, res);
      res.end();
    });
  });

  app.patch("/api/jobs/:id/override", (req, res, next) => {
    try {
      const payload = overridePayloadSchema.parse(req.body);
      const job = jobService.saveOverride(req.params.id, {
        startSec: payload.keepStartSec,
        endSec: payload.keepEndSec
      });
      res.json(jobService.toResponse(job));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/jobs/:id/render", (req, res, next) => {
    try {
      const job = jobService.getJob(req.params.id);
      if (!job) {
        throw new AppError("JOB_NOT_FOUND", `Job ${req.params.id} not found.`, 404);
      }
      queue.push(async () => {
        await jobService.render(req.params.id);
      });
      res.status(202).json({
        id: job.id,
        status: job.status,
        message: "Render enqueued."
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/jobs/:id/output", (req, res, next) => {
    try {
      const job = jobService.getJob(req.params.id);
      if (!job) {
        throw new AppError("JOB_NOT_FOUND", `Job ${req.params.id} not found.`, 404);
      }
      if (!job.outputPath || !fs.existsSync(job.outputPath)) {
        res.status(404).json({
          code: "RENDER_FAILED",
          message: "Output not available yet."
        });
        return;
      }
      res.download(path.resolve(job.outputPath));
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (error instanceof AppError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message
        });
        return;
      }
      res.status(500).json({
        code: "ANALYSIS_FAILED",
        message: error instanceof Error ? error.message : "Unexpected server error."
      });
    }
  );

  return app;
}
