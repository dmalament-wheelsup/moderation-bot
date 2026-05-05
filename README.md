# moderation-bot

Cloudflare Worker that listens for Supabase `INSERT` events on `public.annotations` and `public.annotation_replies`, runs the new row's text through Claude Haiku 4.5 for moderation, and posts an alert to Slack when the verdict is `flag` or `block`. `allow` verdicts are silently dropped.

## Architecture

```
Supabase (INSERT) → Database Webhook → Worker /webhook
                                           ↓
                                       Claude Haiku 4.5 (cached system prompt)
                                           ↓
                                  verdict ∈ { allow, flag, block }
                                           ↓
                              flag/block → Slack Incoming Webhook
                              allow      → no-op
```

The Worker returns `202 Accepted` immediately and runs moderation in `ctx.waitUntil` so the webhook never blocks on the Anthropic call.

## Setup

### 1. Install

```sh
npm install
```

### 2. Configure secrets

Three secrets are required. For production:

```sh
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put SLACK_WEBHOOK_URL
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in the values.

- `ANTHROPIC_API_KEY` — from https://console.anthropic.com/
- `WEBHOOK_SECRET` — generate a long random string (e.g. `openssl rand -hex 32`); Supabase will send it in the `X-Webhook-Secret` header
- `SLACK_WEBHOOK_URL` — create at https://api.slack.com/apps → your app → Incoming Webhooks → Add New Webhook to Workspace, choose the alert channel

### 3. Deploy

```sh
npm run deploy
```

Wrangler prints the Worker URL, e.g. `https://moderation-bot.<your-subdomain>.workers.dev`. The webhook endpoint is that URL + `/webhook`.

### 4. Configure the Supabase webhooks

In the Supabase dashboard, go to **Database → Webhooks → Create a new hook** and create one webhook per table:

| Field             | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Name              | `moderate-annotations` / `moderate-annotation-replies`      |
| Table             | `public.annotations` / `public.annotation_replies`          |
| Events            | `Insert`                                                    |
| Type              | `HTTP Request`                                              |
| Method            | `POST`                                                      |
| URL               | `https://moderation-bot.<your-subdomain>.workers.dev/webhook` |
| HTTP Headers      | `X-Webhook-Secret: <same value as WEBHOOK_SECRET>`          |

## Local development

```sh
npm run dev
```

Test with a sample payload:

```sh
curl -X POST http://127.0.0.1:8787/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $(grep WEBHOOK_SECRET .dev.vars | cut -d= -f2)" \
  -d '{
    "type": "INSERT",
    "schema": "public",
    "table": "annotations",
    "record": { "id": "test-1", "annotation_text": "I hate everyone in this group, they should all be hurt." },
    "old_record": null
  }'
```

You should get `202 Accepted` immediately, then see a Slack message land in the configured channel a second or two later.

## Adding more tables

Edit the `TEXT_COLUMN_BY_TABLE` map in `src/index.ts`:

```ts
const TEXT_COLUMN_BY_TABLE: Record<string, string> = {
  annotations: "annotation_text",
  annotation_replies: "reply_text",
  // new_table: "text_column",
};
```

…then add a matching Supabase Database Webhook for that table.

## Tuning the policy

The policy lives in `SYSTEM_PROMPT` in `src/moderate.ts`. The system prompt is cached (`cache_control: ephemeral`), so iterating on the policy is cheap — only the first call after an edit pays full input-token cost.
