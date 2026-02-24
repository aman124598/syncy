import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { JobEvent, JobRecord, PreflightResponse } from "@syncy/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type ApiJob = JobRecord & {
  videoUrl: string;
  replacementAudioUrl?: string;
  outputUrl?: string;
};

function formatSec(value: number): string {
  return `${value.toFixed(2)}s`;
}

function statusBadgeClass(status: JobRecord["status"]): string {
  if (status === "failed") {
    return "badge fail";
  }
  if (status === "completed" || status === "awaiting_review") {
    return "badge ok";
  }
  return "badge";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error((payload as { message?: string }).message ?? `Request failed: ${response.status}`);
  }
  return payload;
}

export default function App() {
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [replacementAudio, setReplacementAudio] = useState<File | null>(null);
  const [job, setJob] = useState<ApiJob | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [keepStartSec, setKeepStartSec] = useState(0);
  const [keepEndSec, setKeepEndSec] = useState(0);
  const [overrideDirty, setOverrideDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshJob(jobId: string): Promise<void> {
    const latest = await fetchJson<ApiJob>(`${API_BASE}/api/jobs/${jobId}`);
    setJob(latest);
  }

  useEffect(() => {
    fetchJson<PreflightResponse>(`${API_BASE}/api/preflight`)
      .then(setPreflight)
      .catch((err: Error) => {
        setPreflight({
          ok: false,
          checks: [{ name: "api", ok: false, details: err.message }]
        });
      });
  }, []);

  useEffect(() => {
    if (!job) {
      return;
    }

    const source = new EventSource(`${API_BASE}/api/jobs/${job.id}/events`);
    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as JobEvent;
        setEvents((current) => [...current.slice(-149), payload]);
        if (payload.type === "status" || payload.type === "complete" || payload.type === "error") {
          void refreshJob(job.id);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    const interval = window.setInterval(() => {
      if (!job.id) {
        return;
      }
      void refreshJob(job.id);
    }, 2200);

    return () => {
      window.clearInterval(interval);
      source.close();
    };
  }, [job?.id]);

  useEffect(() => {
    if (!job || overrideDirty) {
      return;
    }
    const selected = job.overrideKeepRange ?? job.decision?.keepRange;
    if (!selected) {
      return;
    }
    setKeepStartSec(selected.startSec);
    setKeepEndSec(selected.endSec);
  }, [job?.id, job?.decision?.keepRange.startSec, job?.decision?.keepRange.endSec, job?.overrideKeepRange?.startSec, job?.overrideKeepRange?.endSec, overrideDirty]);

  const overrideDurationSec = useMemo(() => keepEndSec - keepStartSec, [keepEndSec, keepStartSec]);

  async function submitJob(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!video) {
      setError("Please select a video file.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setEvents([]);

    try {
      const formData = new FormData();
      formData.append("video", video);
      if (replacementAudio) {
        formData.append("replacementAudio", replacementAudio);
      }

      const created = await fetchJson<ApiJob>(`${API_BASE}/api/jobs`, {
        method: "POST",
        body: formData
      });
      setJob(created);
      setOverrideDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveOverride(): Promise<void> {
    if (!job) {
      return;
    }
    setSavingOverride(true);
    setError(null);
    try {
      const updated = await fetchJson<ApiJob>(`${API_BASE}/api/jobs/${job.id}/override`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          keepStartSec,
          keepEndSec
        })
      });
      setJob(updated);
      setOverrideDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingOverride(false);
    }
  }

  async function triggerRender(): Promise<void> {
    if (!job) {
      return;
    }
    setRendering(true);
    setError(null);
    try {
      await fetchJson(`${API_BASE}/api/jobs/${job.id}/render`, {
        method: "POST"
      });
      await refreshJob(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  return (
    <main className="app">
      <section className="hero">
        <h1>Syncy: Context-Aware Video Trimming</h1>
        <p>Upload media, review AI trim suggestions, and render synchronized output locally.</p>
      </section>

      <section className="panel grid">
        <div className="row">
          <strong>Environment Preflight</strong>
          {preflight ? (
            <span className={preflight.ok ? "badge ok" : "badge fail"}>{preflight.ok ? "Ready" : "Not Ready"}</span>
          ) : (
            <span className="badge">Checking</span>
          )}
        </div>
        {preflight && (
          <ul className="event-log">
            {preflight.checks.map((check) => (
              <li key={check.name}>
                <span className={check.ok ? "badge ok" : "badge fail"}>{check.name}</span>{" "}
                <span className="mono">{check.details}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <form className="grid" onSubmit={submitJob}>
          <label>
            Video file
            <input
              type="file"
              accept="video/*"
              onChange={(event) => setVideo(event.target.files?.[0] ?? null)}
              required
            />
          </label>

          <label>
            Optional replacement audio
            <input
              type="file"
              accept="audio/*"
              onChange={(event) => setReplacementAudio(event.target.files?.[0] ?? null)}
            />
          </label>

          <button type="submit" disabled={submitting}>
            {submitting ? "Uploading..." : "Create Analysis Job"}
          </button>
        </form>
      </section>

      {error && (
        <section className="panel">
          <p className="warning">{error}</p>
        </section>
      )}

      {job && (
        <>
          <section className="panel grid two">
            <article className="grid">
              <div className="row">
                <strong>Job Status</strong>
                <span className={statusBadgeClass(job.status)}>{job.status}</span>
              </div>
              <p className="small mono">Job ID: {job.id}</p>
              <p className="small">Video duration: {formatSec(job.videoDurationSec)}</p>
              <p className="small">Target duration: {formatSec(job.targetDurationSec)}</p>
              <p className="small">Delta: {formatSec(job.deltaSec)}</p>
              {job.errorMessage && <p className="warning">{job.errorMessage}</p>}
            </article>

            <article className="grid">
              <strong>Suggestion</strong>
              {job.decision ? (
                <>
                  <p className="small">Strategy: <span className="mono">{job.decision.strategy}</span></p>
                  <p className="small">Confidence: {(job.decision.confidence * 100).toFixed(1)}%</p>
                  <p className="small">
                    Suggested keep range: <span className="mono">{formatSec(job.decision.keepRange.startSec)} to {formatSec(job.decision.keepRange.endSec)}</span>
                  </p>
                  <ul className="event-log">
                    {job.decision.reasoning.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="small">Suggestion available after analysis completes.</p>
              )}
            </article>
          </section>

          <section className="panel grid two">
            <article className="grid">
              <strong>Manual Override</strong>
              <label>
                Keep start ({formatSec(keepStartSec)})
                <input
                  type="range"
                  min={0}
                  max={job.videoDurationSec}
                  step={0.05}
                  value={keepStartSec}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setKeepStartSec(Math.min(value, keepEndSec - 0.05));
                    setOverrideDirty(true);
                  }}
                />
              </label>
              <label>
                Keep end ({formatSec(keepEndSec)})
                <input
                  type="range"
                  min={0}
                  max={job.videoDurationSec}
                  step={0.05}
                  value={keepEndSec}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setKeepEndSec(Math.max(value, keepStartSec + 0.05));
                    setOverrideDirty(true);
                  }}
                />
              </label>
              <p className="small">Override duration: {formatSec(Math.max(0, overrideDurationSec))}</p>
              {Math.abs(overrideDurationSec - job.targetDurationSec) > 0.25 && (
                <p className="warning">Override duration must match target within 0.25s.</p>
              )}
              <button disabled={!overrideDirty || savingOverride} onClick={saveOverride}>
                {savingOverride ? "Saving..." : "Save Override"}
              </button>
            </article>

            <article className="grid">
              <strong>Render</strong>
              <p className="small">
                Uses override if set, otherwise the AI recommendation.
              </p>
              <button
                disabled={rendering || job.status === "failed" || !job.decision}
                onClick={triggerRender}
              >
                {rendering ? "Queueing..." : "Render Output"}
              </button>
              {job.outputUrl && (
                <p className="small">
                  Output ready: <a href={`${API_BASE}${job.outputUrl}`}>Download MP4</a>
                </p>
              )}
            </article>
          </section>

          <section className="panel grid two">
            <article className="grid">
              <strong>Source Preview</strong>
              <video controls src={`${API_BASE}${job.videoUrl}`} />
              {job.replacementAudioUrl && (
                <>
                  <p className="small">Replacement audio preview</p>
                  <audio controls src={`${API_BASE}${job.replacementAudioUrl}`} />
                </>
              )}
            </article>

            <article className="grid">
              <strong>Rendered Output</strong>
              {job.outputUrl ? (
                <video controls src={`${API_BASE}${job.outputUrl}`} />
              ) : (
                <p className="small">Render output appears here once completed.</p>
              )}
            </article>
          </section>

          <section className="panel">
            <strong>Live Events</strong>
            <ul className="event-log">
              {events.length === 0 && <li>No events yet.</li>}
              {events.map((event, index) => (
                <li key={`${event.timestamp}-${index}`}>
                  <span className="mono">{event.timestamp}</span> | <strong>{event.type}</strong>
                  {event.message ? ` | ${event.message}` : ""}
                  {typeof event.progress === "number" ? ` | ${(event.progress * 100).toFixed(0)}%` : ""}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
