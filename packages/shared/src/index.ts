import { z } from "zod";

export const jobStatusValues = [
  "queued",
  "analyzing",
  "awaiting_review",
  "rendering",
  "completed",
  "failed"
] as const;

export type JobStatus = (typeof jobStatusValues)[number];

export const trimStrategyValues = [
  "outro",
  "intro",
  "intro_outro",
  "fallback_low_density"
] as const;

export type TrimStrategy = (typeof trimStrategyValues)[number];

export const errorCodeValues = [
  "AUDIO_LONGER_THAN_VIDEO",
  "NO_SYNC_SAFE_CUT",
  "INVALID_OVERRIDE_RANGE",
  "DEPENDENCY_MISSING",
  "ANALYSIS_FAILED",
  "RENDER_FAILED",
  "JOB_NOT_FOUND",
  "MODEL_MISSING"
] as const;

export type ErrorCode = (typeof errorCodeValues)[number];

export const timeRangeBaseSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0)
});

export const timeRangeSchema = timeRangeBaseSchema
  .refine((value) => value.endSec > value.startSec, {
    message: "endSec must be greater than startSec"
  });

export type TimeRange = z.infer<typeof timeRangeSchema>;

export const speechRegionSchema = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    text: z.string().default(""),
    confidence: z.number().min(0).max(1).optional()
  })
  .refine((value) => value.endSec > value.startSec, {
    message: "endSec must be greater than startSec"
  });

export const trimDecisionSchema = z.object({
  keepRange: timeRangeSchema,
  trimNeededSec: z.number().min(0),
  strategy: z.enum(trimStrategyValues),
  confidence: z.number().min(0).max(1),
  reasoning: z.array(z.string()),
  protectedRanges: z.array(timeRangeSchema)
});

export type TrimDecision = z.infer<typeof trimDecisionSchema>;

export type SpeechRegion = z.infer<typeof speechRegionSchema>;

export const lowInfoRegionSchema = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    score: z.number().min(0).max(1)
  })
  .refine((value) => value.endSec > value.startSec, {
    message: "endSec must be greater than startSec"
  });

export type LowInfoRegion = z.infer<typeof lowInfoRegionSchema>;

export const analysisResultSchema = z.object({
  speechRegions: z.array(speechRegionSchema),
  silenceRegions: z.array(timeRangeSchema),
  sceneCutsSec: z.array(z.number().min(0)),
  lowInfoRegions: z.array(lowInfoRegionSchema),
  warnings: z.array(z.string())
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export const jobRecordSchema = z.object({
  id: z.string(),
  status: z.enum(jobStatusValues),
  videoPath: z.string(),
  replacementAudioPath: z.string().optional(),
  outputPath: z.string().optional(),
  videoDurationSec: z.number().min(0),
  targetDurationSec: z.number().min(0),
  deltaSec: z.number(),
  decision: trimDecisionSchema.optional(),
  overrideKeepRange: timeRangeSchema.optional(),
  errorCode: z.enum(errorCodeValues).optional(),
  errorMessage: z.string().optional(),
  analysisResult: analysisResultSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type JobRecord = z.infer<typeof jobRecordSchema>;

export const createJobResponseSchema = z.object({
  id: z.string(),
  status: z.enum(jobStatusValues)
});

export const jobEventSchema = z.object({
  type: z.enum(["status", "progress", "log", "error", "complete"]),
  message: z.string().optional(),
  progress: z.number().min(0).max(1).optional(),
  status: z.enum(jobStatusValues).optional(),
  timestamp: z.string()
});

export type JobEvent = z.infer<typeof jobEventSchema>;

export const overridePayloadSchema = z.object({
  keepStartSec: z.number().min(0),
  keepEndSec: z.number().min(0)
});

export type OverridePayload = z.infer<typeof overridePayloadSchema>;

export const preflightResponseSchema = z.object({
  ok: z.boolean(),
  checks: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      details: z.string()
    })
  )
});

export type PreflightResponse = z.infer<typeof preflightResponseSchema>;
