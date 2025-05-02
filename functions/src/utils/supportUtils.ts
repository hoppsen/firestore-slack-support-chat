import { Request } from 'firebase-functions/v2/https';
import { createHmac } from 'crypto';
import { WebClient } from '@slack/web-api';
import { emojify } from 'node-emoji';
import { logger } from 'firebase-functions';

import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET } from './params';

// Similar to how firebase-admin is initialized
let slackClient: WebClient;
export const getSlackClient = () => {
  if (!slackClient) {
    slackClient = new WebClient(SLACK_BOT_TOKEN.value());
  }
  return slackClient;
};

interface ThreadMessage {
  projectId?: string;
  userId: string;
  botId?: string;
}

/**
 * Builds a Slack message for a support thread.
 *
 * @param {Object} params - The parameters object
 * @param {string} [params.projectId] - The project ID
 * @param {string} params.userId - The user ID
 * @param {string} [params.botId] - The bot ID
 * @return {Object} The Slack message object
 */
export function buildThreadMessage({ projectId, userId, botId }: ThreadMessage) {
  const projectSection = projectId ? `*Project:* \`${projectId}\`\n` : '';
  const responseInstructions = botId ?
    `To respond, mention <@${botId}> in the thread.` :
    'To respond, use this thread.';

  // Create the plain text version for fallback
  const text = `Support request from user \`${userId}\``;

  return {
    text, // Default fallback text for the message if rich text is not supported
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${projectSection}*User:* \`${userId}\`\n\n${responseInstructions}`,
        },
      },
      projectId && {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Open in Firebase 🔗',
              emoji: true,
            },
            url: `https://console.firebase.google.com/u/0/project/${projectId}/firestore/databases/-default-/data/~2Fusers~2F${userId}`,
            action_id: 'open_dashboard',
          },
        ],
      },
    ].filter(Boolean), // Remove any undefined blocks (when projectId is not provided)
  };
}

/**
 * Validates a Slack request.
 *
 * @param {Request} request - The request object
 * @return {boolean} True if the request is valid, false otherwise
 */
export const isValidSlackRequest = (request: Request) => {
  const ts = request.headers['x-slack-request-timestamp'];
  const sig = request.headers['x-slack-signature'];
  const hmac = createHmac('sha256', SLACK_SIGNING_SECRET.value());
  const body = `v0:${ts}:${request.rawBody}`;
  hmac.update(body);
  return `v0=${hmac.digest('hex')}` === sig;
};

/**
 * Converts Slack/Unicode short-codes to emojis.
 *
 * @param {string} message - The message to convert
 * @return {string} The message with emojis
 */
export function emojifyMessage(message: string): string {
  // First convert all standard emojis
  const withEmojis = emojify(message);

  // Then remove any remaining :shortcode: patterns (custom Slack emojis)
  return withEmojis
    .replace(/:([a-zA-Z0-9_+-]+):/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Sends an error message to Slack.
 *
 * @param {string} message - The message to send
 * @param {string} [threadTs] - The thread timestamp
 */
export function sendSlackErrorMessage(message: string, threadTs?: string) {
  const slack = getSlackClient();

  if (threadTs) {
    logger.warn('sendSlackErrorMessage(): Thread timestamp is not set. Skipping error message...');
    return;
  }

  const channel = process.env.SLACK_CHANNEL_ID;
  if (!channel) {
    logger.warn('sendSlackErrorMessage(): Slack channel ID is not set. Skipping error message...');
    return;
  }

  slack.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: message,
    username: 'Error',
    icon_emoji: ':warning:',
  });
}
