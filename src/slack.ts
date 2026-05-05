import type { ModerationResult } from "./moderate.js";

export interface SlackAlert {
  table: string;
  rowId: string;
  text: string;
  result: ModerationResult;
}

export async function postSlackAlert(
  webhookUrl: string,
  alert: SlackAlert,
): Promise<void> {
  const verdictEmoji = alert.result.verdict === "block" ? ":no_entry:" : ":warning:";
  const truncated =
    alert.text.length > 500 ? `${alert.text.slice(0, 500)}…` : alert.text;

  const payload = {
    text: `${verdictEmoji} Moderation ${alert.result.verdict.toUpperCase()} on ${alert.table}#${alert.rowId}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${verdictEmoji} ${alert.result.verdict.toUpperCase()}: ${alert.table}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Row ID*\n\`${alert.rowId}\`` },
          {
            type: "mrkdwn",
            text: `*Categories*\n${
              alert.result.categories.length > 0
                ? alert.result.categories.map((c) => `\`${c}\``).join(", ")
                : "_none_"
            }`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Reason*\n${alert.result.reason || "_none provided_"}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Content*\n>>>${truncated}`,
        },
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed: ${response.status} ${body}`);
  }
}
