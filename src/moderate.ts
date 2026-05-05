import Anthropic from "@anthropic-ai/sdk";

export type Verdict = "allow" | "flag" | "block";

export interface ModerationResult {
  verdict: Verdict;
  reason: string;
  categories: string[];
}

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a content moderation classifier. You will be given a single piece of user-generated text. Decide whether it violates the policy below and respond ONLY with a JSON object.

# Policy categories
- harassment: targeted insults, bullying, threats against individuals
- hate: dehumanizing or discriminatory content targeting protected groups
- sexual: explicit sexual content, especially involving minors (always block)
- violence: graphic violence, incitement to violence, glorification of harm
- self_harm: encouragement or instructions for self-harm or suicide
- illegal: instructions for clearly illegal acts (weapons, drug synthesis, fraud, CSAM)

# Verdicts
- "allow": no violation; clearly safe content
- "flag": borderline, low-severity, or potentially problematic — a human should review
- "block": clear, high-severity violation that should be removed

# Output format
Respond with a single JSON object and nothing else:
{
  "verdict": "allow" | "flag" | "block",
  "reason": "<one short sentence; empty string if allow>",
  "categories": ["<zero or more category names from the list above>"]
}

Be conservative on "block" — reserve it for clear, severe violations. When unsure, prefer "flag".`;

export async function moderate(
  text: string,
  apiKey: string,
): Promise<ModerationResult> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Moderate the following text:\n\n<text>\n${text}\n</text>`,
      },
    ],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Unexpected response shape from Anthropic API");
  }

  return parseModerationJson(block.text);
}

function parseModerationJson(raw: string): ModerationResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Moderation response did not contain JSON: ${raw}`);
  }

  const parsed = JSON.parse(match[0]) as Partial<ModerationResult>;

  if (
    parsed.verdict !== "allow" &&
    parsed.verdict !== "flag" &&
    parsed.verdict !== "block"
  ) {
    throw new Error(`Invalid verdict in moderation response: ${raw}`);
  }

  return {
    verdict: parsed.verdict,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    categories: Array.isArray(parsed.categories)
      ? parsed.categories.filter((c): c is string => typeof c === "string")
      : [],
  };
}
