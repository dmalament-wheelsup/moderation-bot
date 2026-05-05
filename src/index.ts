import { moderate } from "./moderate.js";
import { postSlackAlert } from "./slack.js";

interface Env {
  ANTHROPIC_API_KEY: string;
  WEBHOOK_SECRET: string;
  SLACK_WEBHOOK_URL: string;
}

interface SupabaseWebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

const TEXT_COLUMN_BY_TABLE: Record<string, string> = {
  annotations: "annotation_text",
  annotation_replies: "reply_text",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/webhook") {
      return new Response("Not Found", { status: 404 });
    }

    if (!timingSafeEqual(request.headers.get("X-Webhook-Secret"), env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload: SupabaseWebhookPayload;
    try {
      payload = (await request.json()) as SupabaseWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.type !== "INSERT" || !payload.record) {
      return new Response("Ignored", { status: 200 });
    }

    const textColumn = TEXT_COLUMN_BY_TABLE[payload.table];
    if (!textColumn) {
      return new Response(`Unsupported table: ${payload.table}`, { status: 200 });
    }

    const text = payload.record[textColumn];
    if (typeof text !== "string" || text.trim().length === 0) {
      return new Response("No text to moderate", { status: 200 });
    }

    const rowId = String(payload.record["id"] ?? "unknown");

    ctx.waitUntil(processModeration(env, payload.table, rowId, text));

    return new Response("Accepted", { status: 202 });
  },
} satisfies ExportedHandler<Env>;

async function processModeration(
  env: Env,
  table: string,
  rowId: string,
  text: string,
): Promise<void> {
  try {
    const result = await moderate(text, env.ANTHROPIC_API_KEY);

    if (result.verdict === "allow") {
      return;
    }

    await postSlackAlert(env.SLACK_WEBHOOK_URL, {
      table,
      rowId,
      text,
      result,
    });
  } catch (err) {
    console.error("Moderation pipeline failed", {
      table,
      rowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function timingSafeEqual(a: string | null, b: string): boolean {
  if (a === null || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
