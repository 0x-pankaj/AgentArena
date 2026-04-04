// Critical error alerting via webhook (Slack, Discord, etc.)
// Sends structured payloads to a configurable webhook URL.

interface AlertPayload {
  type: "critical" | "warning" | "info";
  service: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

let alertCache: Array<{ key: string; timestamp: number }> = [];
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown per unique alert

function getAlertKey(type: string, service: string, message: string): string {
  return `${type}:${service}:${message.slice(0, 80)}`;
}

function isAlertCooldown(key: string): boolean {
  const now = Date.now();
  alertCache = alertCache.filter((a) => now - a.timestamp < ALERT_COOLDOWN_MS);
  return alertCache.some((a) => a.key === key);
}

function recordAlert(key: string): void {
  alertCache.push({ key, timestamp: Date.now() });
}

async function sendWebhookAlert(payload: AlertPayload): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const slackPayload = {
      text: `🚨 [${payload.type.toUpperCase()}] ${payload.service}: ${payload.message}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${payload.type.toUpperCase()}* — *${payload.service}*\n${payload.message}`,
          },
        },
        ...(payload.details
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "```" + JSON.stringify(payload.details, null, 2).slice(0, 2000) + "```",
                },
              },
            ]
          : []),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Timestamp: ${payload.timestamp}`,
            },
          ],
        },
      ],
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload),
    });
  } catch (err) {
    console.error("[Alert] Failed to send webhook:", err);
  }
}

export async function sendAlert(params: {
  type: "critical" | "warning" | "info";
  service: string;
  message: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const key = getAlertKey(params.type, params.service, params.message);

  if (isAlertCooldown(key)) return;
  recordAlert(key);

  const payload: AlertPayload = {
    ...params,
    timestamp: new Date().toISOString(),
  };

  await sendWebhookAlert(payload);

  if (params.type === "critical") {
    console.error(`[Alert] CRITICAL — ${params.service}: ${params.message}`);
  } else if (params.type === "warning") {
    console.warn(`[Alert] WARNING — ${params.service}: ${params.message}`);
  }
}
