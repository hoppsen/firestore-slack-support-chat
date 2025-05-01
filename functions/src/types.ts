import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const ERROR_TYPE = {
  SOMETHING_WENT_WRONG: 'something_went_wrong',
} as const;
export type ErrorType = typeof ERROR_TYPE[keyof typeof ERROR_TYPE];

export const SUPPORT_MESSAGE_ROLE = {
  USER: 'user',
  INTERNAL: 'internal',
} as const;
export type SupportMessageRole = typeof SUPPORT_MESSAGE_ROLE[keyof typeof SUPPORT_MESSAGE_ROLE];

export const SUPPORT_MESSAGE_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
} as const;
export type SupportMessageStatus = typeof SUPPORT_MESSAGE_STATUS[keyof typeof SUPPORT_MESSAGE_STATUS];

// Default: users/{userId}/support/default
export interface SupportDefaultDocument {
  threadCreatedAt: Timestamp | FieldValue;
  slackThreadTs: string;
}

// Default: users/{userId}/support/default/messages/{supportMessageId}
export interface SupportMessageDocument {
  // Set by the chat client
  createdAt: Timestamp | FieldValue;
  message: string;
  role: SupportMessageRole;

  // Set by the extension
  status: SupportMessageStatus;
  slackThreadTs?: string;
  rawMessage?: string;
  error?: ErrorType;
}
