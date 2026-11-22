import crypto from "crypto";

const DEFAULT_API_BASE_URL = "https://api.getcircuit.com/public/v0.2b";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_OPTIMIZATION_MAX_WAIT_MS = 120000;
const OPTIMIZATION_POLL_MS = 5000;
// Spoke (Circuit) caps write endpoints at 5 req/s and reads at 10 req/s, signalling
// overflow with HTTP 429. Retries are safe because every write carries an Idempotency-Key,
// so Circuit dedupes a replayed request instead of creating a second stop/plan.
const DEFAULT_MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8000;

export function getSpokeTrackingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export class SpokeDispatchError extends Error {
  statusCode: number;
  responsePayload: unknown;
  workflowStep: string;
  upstreamStatus: number | null;

  constructor(
    message: string,
    statusCode = 502,
    responsePayload: unknown = null,
    workflowStep = "SPOKE_REQUEST",
    upstreamStatus: number | null = null
  ) {
    super(message);
    this.name = "SpokeDispatchError";
    this.statusCode = statusCode;
    this.responsePayload = responsePayload;
    this.workflowStep = workflowStep;
    // The true HTTP status Circuit returned (null for network/timeout). Kept for diagnosis
    // and audit; distinct from `statusCode`, which is the status we surface to our own UI.
    this.upstreamStatus = upstreamStatus;
  }
}

export interface SpokeDateParts {
  year: number;
  month: number;
  day: number;
}

export interface SpokeOrderInput {
  idempotencyKey: string;
  patientId: string | null;
  store: {
    id: string;
    slug: string;
    name: string;
  };
  providerUser: {
    id: string;
    name: string;
    email: string;
  } | null;
  patientName: string;
  patientPhone: string | null;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPostalCode: string;
  deliveryZoneName: string;
  instructions: string | null;
  scheduledDate: Date;
  scheduledDateKey: string;
}

export interface SpokeRequestResult<T = unknown> {
  requestPayload: unknown;
  responsePayload: T;
}

export interface SpokePlanResult extends SpokeRequestResult {
  planId: string;
}

export interface SpokeStopResult extends SpokeRequestResult {
  stopId: string;
  pending: boolean;
}

export interface SpokeOperationResult extends SpokeRequestResult {
  operationId: string;
}

export interface SpokeConfig {
  apiBaseUrl: string;
  apiKey: string;
  circuitClientId: string | null;
  timeoutMs: number;
  optimizationMaxWaitMs: number;
  maxAttempts: number;
}

export function getSpokeProviderUserIds() {
  return new Set(
    (process.env.SPOKE_PROVIDER_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

export function shouldRouteToSpoke(input: {
  assignedDriverId: string | null;
  isExternalProvider: boolean;
  deliveryCompany: string | null;
}) {
  return (
    input.isExternalProvider === true ||
    input.deliveryCompany === "Spoke_Partner" ||
    (input.assignedDriverId
      ? getSpokeProviderUserIds().has(input.assignedDriverId)
      : false)
  );
}

export function parseScheduledDateKey(value: string, fallback: Date) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : fallback.toISOString().slice(0, 10);
}

export function spokeDatePartsFromKey(dateKey: string): SpokeDateParts {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

export function spokePlanDateFromKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function buildSpokePlanKey(input: {
  storeId: string;
  providerUserId: string | null;
  scheduledDateKey: string;
}) {
  return [
    "SPOKE",
    input.storeId,
    input.providerUserId ?? "external-provider",
    input.scheduledDateKey,
  ].join(":");
}

export function buildSpokePlanTitle(input: {
  storeName: string;
  providerName: string | null;
  scheduledDateKey: string;
}) {
  return `${input.storeName} - ${input.providerName ?? "Spoke"} - ${input.scheduledDateKey}`;
}

export function buildSpokePlanPayload(input: {
  title: string;
  starts: SpokeDateParts;
}) {
  return {
    title: input.title,
    starts: input.starts,
  };
}

export function buildSpokeStopPayload(input: SpokeOrderInput, circuitClientId: string | null) {
  const notes = [
    input.instructions,
    `Zone: ${input.deliveryZoneName}`,
    `Scheduled date: ${input.scheduledDateKey}`,
    `Store: ${input.store.name}`,
  ]
    .filter(Boolean)
    .join("\n");

  const payload: Record<string, unknown> = {
    address: {
      addressName: input.patientName,
      addressLineOne: input.deliveryAddress,
      city: input.deliveryCity,
      state: "BC",
      zip: input.deliveryPostalCode,
      country: "CA",
    },
    recipient: {
      externalId: input.patientId ?? input.idempotencyKey,
      phone: input.patientPhone,
      name: input.patientName,
    },
    orderInfo: {
      products: ["Pharmacy delivery"],
      sellerOrderId: input.idempotencyKey,
      sellerName: input.store.name,
    },
    activity: "delivery",
    packageCount: 1,
    notes,
  };

  if (circuitClientId) {
    payload.circuitClientId = circuitClientId;
  }

  return payload;
}

function parsePositiveEnvInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSpokeConfig(): SpokeConfig {
  const apiBaseUrl = (process.env.SPOKE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim().replace(/\/$/, "");
  const apiKey = process.env.SPOKE_API_KEY?.trim();
  const circuitClientId = process.env.SPOKE_CIRCUIT_CLIENT_ID?.trim() || null;

  if (!apiKey) {
    throw new SpokeDispatchError(
      "Spoke integration is not configured. Please set SPOKE_API_KEY.",
      500,
      null,
      "SETUP"
    );
  }

  return {
    apiBaseUrl,
    apiKey,
    circuitClientId,
    timeoutMs: parsePositiveEnvInt("SPOKE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    optimizationMaxWaitMs: parsePositiveEnvInt(
      "SPOKE_OPTIMIZATION_MAX_WAIT_MS",
      DEFAULT_OPTIMIZATION_MAX_WAIT_MS
    ),
    maxAttempts: parsePositiveEnvInt("SPOKE_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
  };
}

async function parseResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function pathToUrl(config: SpokeConfig, path: string) {
  return `${config.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

// Transient upstream conditions worth retrying: rate limits (429), request timeout (408),
// and any 5xx. Deterministic client errors (400/401/403/404/409/422) are NOT retried —
// replaying them would just fail again.
function isRetryableUpstreamStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// Translate Circuit's HTTP status into the status we expose on our own API surface.
// Deliberately conservative: never surface Spoke's 401/403 as the user's own auth failure —
// the pharmacy portal would treat that as session expiry and bounce them to the login page.
function mapUpstreamToOutwardStatus(status: number) {
  if (status === 400 || status === 422) return 400; // bad address / validation — user fixable
  if (status === 409) return 409; // conflict (duplicate / idempotency)
  if (status === 429) return 503; // rate-limited and out of retries
  return 502; // 401/403/404/5xx/unknown → upstream failure, not a user auth problem
}

// Retry-After may be an integer number of seconds or an HTTP-date.
function parseRetryAfterMs(headerValue: string | null) {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

// Exponential backoff with light jitter (attempt is 1-based), never shorter than Retry-After.
function backoffDelayMs(attempt: number, retryAfterMs: number | null) {
  const exponential = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
  );
  const jitter = Math.floor(Math.random() * RETRY_BASE_DELAY_MS);
  return Math.max(retryAfterMs ?? 0, exponential + jitter);
}

async function spokeRequest<T>(
  config: SpokeConfig,
  path: string,
  options: {
    method?: "DELETE" | "GET" | "POST";
    body?: unknown;
    workflowStep: string;
    idempotencyKey?: string;
  }
): Promise<SpokeRequestResult<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const maxAttempts = Math.max(1, config.maxAttempts);
  let lastError: SpokeDispatchError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Each attempt gets its own AbortController so the per-request timeout applies cleanly
    // on every try rather than spanning all retries.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(pathToUrl(config, path), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const responsePayload = await parseResponseBody(response);

      if (response.ok) {
        return {
          requestPayload: options.body ?? null,
          responsePayload: responsePayload as T,
        };
      }

      const requestError = new SpokeDispatchError(
        `Spoke ${options.workflowStep} failed with status ${response.status}.`,
        mapUpstreamToOutwardStatus(response.status),
        responsePayload,
        options.workflowStep,
        response.status
      );

      // Out of budget or a non-retryable status → surface immediately.
      if (attempt === maxAttempts || !isRetryableUpstreamStatus(response.status)) {
        throw requestError;
      }

      lastError = requestError;
      await delay(
        backoffDelayMs(attempt, parseRetryAfterMs(response.headers.get("retry-after")))
      );
    } catch (error) {
      if (error instanceof SpokeDispatchError) throw error;

      // Network failures and timeouts (AbortError) are transient — retry until the budget runs out.
      const isAbort = error instanceof Error && error.name === "AbortError";
      const transientError = new SpokeDispatchError(
        isAbort
          ? `Spoke ${options.workflowStep} request timed out.`
          : error instanceof Error
            ? error.message
            : `Spoke ${options.workflowStep} request failed.`,
        502,
        null,
        options.workflowStep,
        null
      );

      if (attempt === maxAttempts) throw transientError;
      lastError = transientError;
      await delay(backoffDelayMs(attempt, null));
    } finally {
      clearTimeout(timeout);
    }
  }

  // The loop always returns or throws; this satisfies the type checker for the maxAttempts<1 case.
  throw (
    lastError ??
    new SpokeDispatchError(
      `Spoke ${options.workflowStep} request failed.`,
      502,
      null,
      options.workflowStep
    )
  );
}

function objectPayload(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown, field: string) {
  const payload = objectPayload(value);
  const read = payload?.[field];
  return typeof read === "string" && read.trim() ? read.trim() : null;
}

export async function createSpokePlan(
  config: SpokeConfig,
  input: {
    title: string;
    starts: SpokeDateParts;
    idempotencyKey: string;
  }
): Promise<SpokePlanResult> {
  const requestPayload = buildSpokePlanPayload({
    title: input.title,
    starts: input.starts,
  });
  const result = await spokeRequest(config, "/plans", {
    method: "POST",
    body: requestPayload,
    workflowStep: "CREATE_PLAN",
    idempotencyKey: `${input.idempotencyKey}:plan`,
  });
  const planId = readString(result.responsePayload, "id");

  if (!planId) {
    throw new SpokeDispatchError(
      "Spoke created a plan but did not return a plan id.",
      502,
      result.responsePayload,
      "CREATE_PLAN"
    );
  }

  return { ...result, planId };
}

export async function createSpokeStop(
  config: SpokeConfig,
  input: {
    planId: string;
    stopPayload: Record<string, unknown>;
    live: boolean;
    idempotencyKey: string;
  }
): Promise<SpokeStopResult> {
  const workflowStep = input.live ? "LIVE_CREATE_STOP" : "CREATE_STOP";
  const result = await spokeRequest<Record<string, unknown>>(config, `/${input.planId}/stops${input.live ? ":liveCreate" : ""}`, {
    method: "POST",
    body: input.stopPayload,
    workflowStep,
    idempotencyKey: `${input.idempotencyKey}:stop`,
  });
  const response = objectPayload(result.responsePayload);
  const stop = objectPayload(input.live ? response?.stop : response);
  const stopId = typeof stop?.id === "string" ? stop.id : null;

  if (!stopId) {
    throw new SpokeDispatchError(
      "Spoke could not create the delivery stop.",
      502,
      result.responsePayload,
      workflowStep
    );
  }

  return {
    ...result,
    stopId,
    pending: response?.pending === true,
  };
}

export async function createSpokeUnassignedStop(
  config: SpokeConfig,
  input: {
    stopPayload: Record<string, unknown>;
    idempotencyKey: string;
  }
): Promise<SpokeStopResult> {
  const result = await spokeRequest<Record<string, unknown>>(config, "/unassignedStops", {
    method: "POST",
    body: input.stopPayload,
    workflowStep: "CREATE_UNASSIGNED_STOP",
    idempotencyKey: `${input.idempotencyKey}:unassigned-stop`,
  });
  const stopId = readString(result.responsePayload, "id");

  if (!stopId) {
    throw new SpokeDispatchError(
      "Spoke could not create the unassigned delivery stop.",
      502,
      result.responsePayload,
      "CREATE_UNASSIGNED_STOP"
    );
  }

  return {
    ...result,
    stopId,
    pending: false,
  };
}

export async function deleteSpokeUnassignedStop(
  config: SpokeConfig,
  input: {
    unassignedStopId: string;
    idempotencyKey?: string;
  }
) {
  const path = input.unassignedStopId.startsWith("unassignedStops/")
    ? `/${input.unassignedStopId}`
    : `/unassignedStops/${input.unassignedStopId}`;

  return spokeRequest<null>(config, path, {
    method: "DELETE",
    workflowStep: "CANCEL_UNASSIGNED_STOP",
    idempotencyKey: input.idempotencyKey
      ? `${input.idempotencyKey}:cancel-unassigned-stop`
      : undefined,
  });
}

export async function optimizeSpokePlan(
  config: SpokeConfig,
  input: {
    planId: string;
    live: boolean;
    idempotencyKey: string;
  }
): Promise<SpokeOperationResult> {
  const workflowStep = input.live ? "REOPTIMIZE_PLAN" : "OPTIMIZE_PLAN";
  const result = await spokeRequest(config, `/${input.planId}:${input.live ? "reoptimize" : "optimize"}`, {
    method: "POST",
    body: input.live ? { optimizationType: "reorder_changed_stops" } : undefined,
    workflowStep,
    idempotencyKey: `${input.idempotencyKey}:optimize`,
  });
  const operationId = readString(result.responsePayload, "id");

  if (!operationId) {
    throw new SpokeDispatchError(
      "Spoke did not return an optimization operation id.",
      502,
      result.responsePayload,
      workflowStep
    );
  }

  return { ...result, operationId };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSpokeOperation(
  config: SpokeConfig,
  input: {
    operationId: string;
    stopId: string;
  }
) {
  const deadline = Date.now() + config.optimizationMaxWaitMs;
  let lastResult: SpokeRequestResult<Record<string, unknown>> | null = null;

  while (Date.now() <= deadline) {
    const result = await spokeRequest<Record<string, unknown>>(config, `/${input.operationId}`, {
      workflowStep: "POLL_OPTIMIZATION",
    });
    lastResult = result;
    const operation = objectPayload(result.responsePayload);

    if (operation?.done === true) {
      const operationResult = objectPayload(operation.result);
      const code = typeof operationResult?.code === "string" ? operationResult.code : null;
      const message = typeof operationResult?.message === "string" ? operationResult.message : null;

      if (code || message) {
        throw new SpokeDispatchError(
          `Spoke optimization failed${code ? ` with ${code}` : ""}${message ? `: ${message}` : "."}`,
          502,
          result.responsePayload,
          "POLL_OPTIMIZATION"
        );
      }

      const skippedStops = Array.isArray(operationResult?.skippedStops)
        ? operationResult.skippedStops
        : [];
      const skippedCurrentStop = skippedStops.find((skipped) => {
        const skippedPayload = objectPayload(skipped);
        return skippedPayload?.id === input.stopId;
      });

      if (skippedCurrentStop) {
        throw new SpokeDispatchError(
          "Spoke optimization skipped this delivery stop.",
          502,
          result.responsePayload,
          "POLL_OPTIMIZATION"
        );
      }

      return result;
    }

    await delay(Math.min(OPTIMIZATION_POLL_MS, Math.max(1000, deadline - Date.now())));
  }

  throw new SpokeDispatchError(
    "Spoke optimization did not finish before the timeout.",
    502,
    lastResult?.responsePayload ?? null,
    "POLL_OPTIMIZATION"
  );
}

export async function distributeSpokePlan(
  config: SpokeConfig,
  input: {
    planId: string;
    live: boolean;
    idempotencyKey: string;
  }
) {
  const workflowStep = input.live ? "REDISTRIBUTE_PLAN" : "DISTRIBUTE_PLAN";
  return spokeRequest(config, `/${input.planId}:${input.live ? "redistribute" : "distribute"}`, {
    method: "POST",
    workflowStep,
    idempotencyKey: `${input.idempotencyKey}:distribute`,
  });
}

export function verifySpokeSignature(input: {
  rawBody: string;
  signature: string | null;
  secret: string;
}) {
  if (!input.signature) return false;
  const received = input.signature.replace(/^sha256=/i, "").trim();
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;

  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(input.rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

export function mapSpokeWebhookStatus(eventType: string, data: Record<string, unknown>) {
  if (eventType === "stop.allocated") return { status: "ALLOCATED" };
  if (eventType === "stop.out_for_delivery") return { status: "IN_TRANSIT" };
  if (eventType === "stop.departed") return { status: "DEPARTED" };
  if (eventType === "stop.attempted_delivery") {
    const deliveryInfo = objectPayload(data.deliveryInfo);
    const succeeded = deliveryInfo?.succeeded === true;
    return {
      status: succeeded ? "DELIVERED" : "DELIVERY_FAILED",
      deliveredAt: succeeded ? new Date() : null,
      failedAt: succeeded ? null : new Date(),
    };
  }
  if (eventType.endsWith(".tracking_link_added")) {
    return { status: "TRACKING_LINK_ADDED" };
  }

  return { status: "WEBHOOK_RECEIVED" };
}

// Monotonic ordering for external-dispatch statuses. Webhooks can arrive out of
// order or duplicated, and can interleave with our own submission/cancel writes;
// a dispatch may only move forward through this progression, and nothing leaves
// the settled terminal states. DELIVERY_FAILED → DELIVERED stays allowed so a
// re-attempted delivery can still complete. Unknown statuses rank 0 (never able
// to regress a known state).
const DISPATCH_STATUS_RANK: Record<string, number> = {
  SCHEDULED: 0,
  PENDING: 0,
  DISPATCH_FAILED: 1,
  STOP_CREATED: 1,
  SUBMITTED: 2,
  WEBHOOK_RECEIVED: 2,
  DISTRIBUTED: 3,
  ALLOCATED: 3,
  TRACKING_LINK_ADDED: 3,
  IN_TRANSIT: 4,
  DEPARTED: 5,
  DELIVERY_FAILED: 6,
  DELIVERED: 7,
  CANCELLED: 7,
};

const SETTLED_DISPATCH_STATUSES = new Set(["DELIVERED", "CANCELLED"]);

export function canAdvanceDispatchStatus(from: string, to: string) {
  if (SETTLED_DISPATCH_STATUSES.has(from)) return false;
  const fromRank = DISPATCH_STATUS_RANK[from] ?? 0;
  const toRank = DISPATCH_STATUS_RANK[to] ?? 0;
  return toRank >= fromRank;
}
