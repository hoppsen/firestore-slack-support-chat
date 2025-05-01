import { defineSecret } from 'firebase-functions/params';

export const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');
export const SLACK_SIGNING_SECRET = defineSecret('SLACK_SIGNING_SECRET');
