import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from 'firebase-functions/v1';
import { onRequest, Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { db } from './index';
import { Timings } from './utils/timings';
import { getSlackClient, buildThreadMessage, isValidSlackRequest, emojifyMessage, sendSlackErrorMessage } from './utils/supportUtils';
import { SupportMessageDocument, ERROR_TYPE, SUPPORT_MESSAGE_STATUS, SUPPORT_MESSAGE_ROLE, SupportDefaultDocument } from './types';
import { SLACK_SIGNING_SECRET } from './utils/params';

/**
 * Firebase Cloud Function that receives support messages from Firestore and posts them to Slack.
 *
 * @param event - The event object.
 *
 * Note: The path in extension.yaml controls the actual trigger path, not the one in the code.
 *       The path in the code is overridden by the extension configuration.
 */
export const onSupportMessageCreated = firestore.document('users/{userId}/support/default/messages/{supportMessageId}')
  .onCreate(async (snapshot, context) => {
    const timings = new Timings();
    const userId = context.params.userId;
    const supportMessageId = context.params.supportMessageId;
    logger.info('onSupportMessageCreated(): Function started', { userId, supportMessageId });

    try {
      const supportMessageRef = snapshot.ref;
      const supportMessageDocument = snapshot.data() as SupportMessageDocument;

      if (supportMessageDocument.role !== SUPPORT_MESSAGE_ROLE.USER) {
        logger.info('onSupportMessageCreated(): Skipping processing as support message is not from a user.', { userId, supportMessageId });
        return;
      }

      // MARK: - Get environment variables

      const channel = process.env.SLACK_CHANNEL_ID;
      const configPath = process.env.CONFIG_PATH;
      if (!channel || !configPath) {
        logger.error('onSupportMessageCreated(): Slack channel ID or config path is not set', {
          userId,
          supportMessageId,
          channel,
          configPath,
        });
        throw new Error('Slack channel ID or config path is not set');
      }

      // MARK: - Get Slack client

      timings.startTiming('getSlackClient');
      const slack = getSlackClient();
      timings.endTiming('getSlackClient');

      // MARK: - Check if there's an existing thread for this user

      timings.startTiming('checkExistingThread');
      const supportDefaultRef = db.doc(configPath.replace('{userId}', userId));
      const supportDefaultDoc = await supportDefaultRef.get();
      const supportDefaultData = supportDefaultDoc.data() as SupportDefaultDocument;
      let threadTs: string | undefined = supportDefaultData?.slackThreadTs;
      timings.endTiming('checkExistingThread');

      // MARK: - Create a new thread in Slack if user has not already a thread within the Slack #support channel

      const finalPromises = [];
      if (!threadTs) {
        // Create a new thread in Slack
        timings.startTiming('createNewThread');
        const projectId = process.env.PROJECT_ID;
        const result = await slack.chat.postMessage({
          channel,
          username: projectId,
          ...buildThreadMessage({
            projectId,
            userId,
            botId: process.env.SLACK_BOT_ID,
          }),
        });
        timings.endTiming('createNewThread');

        // Store the thread timestamp for future messages
        threadTs = result.ts;
        timings.startTiming('finalPromises');
        finalPromises.push(
          timings.timedPromise('finalPromises:updateSupportDefault', () => supportDefaultRef.set({
            slackThreadTs: threadTs,
          }, { merge: true }))
        );
      } else {
        timings.startTiming('finalPromises');
      }

      finalPromises.push(
        // Send the message to the thread
        timings.timedPromise('finalPromises:sendMessageToThread', () => slack.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: supportMessageDocument.message,
          username: 'User',
          icon_emoji: ':person_with_crown:',
        })),
        // Update the message status to SENT
        timings.timedPromise('finalPromises:updateMessageStatus', () => supportMessageRef.update({
          status: SUPPORT_MESSAGE_STATUS.SENT,
          slackThreadTs: threadTs,
        }))
      );

      await Promise.all(finalPromises);
      timings.endTiming('finalPromises');

      logger.info('onSupportMessageCreated(): Successfully processed support message', {
        userId,
        supportMessageId,
        totalDuration: timings.getTotalDurationInMs(),
        timings: timings.getTimings(),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';
      logger.error('onSupportMessageCreated(): Unexpected error', { userId, supportMessageId, errorMessage, stackTrace });

      await snapshot.ref.update({
        error: ERROR_TYPE.SOMETHING_WENT_WRONG,
        status: SUPPORT_MESSAGE_STATUS.FAILED,
      });
    }
  });

/**
 * Firebase Cloud Function that receives support messages from Slack and posts them to Firestore.
 *
 * @param request - The request object.
 * @param response - The response object.
 */
export const slackSupportEvents = onRequest(
  { // Use extension.yaml to configure the function, this is just for reference
    memory: '256MiB',
    secrets: [SLACK_SIGNING_SECRET],
    invoker: 'public',
  },
  async (request: Request, response) => {
    const timings = new Timings();
    let userId: string | undefined;
    let threadTs: string | undefined;
    logger.info('slackSupportEvents(): Function started', { request });

    try {
      // MARK: - Validate request

      if (!isValidSlackRequest(request)) {
        logger.warn('slackSupportEvents(): Invalid request signature', { request });
        response.status(401).end();
        return;
      }

      // MARK: - Handle URL verification challenge

      // request.body.type is different from request.body.event.type
      const { type, challenge, event } = request.body;
      if (type === 'url_verification') {
        logger.debug('slackSupportEvents(): Handling URL verification challenge', { type, challenge, event });
        response.send(challenge);
        return;
      }

      // MARK: - Guard clause for event requirements

      threadTs = event.thread_ts;
      logger.info('slackSupportEvents(): Processing event', { threadTs, fromUser: event.user, event });
      if (event.type !== 'app_mention' || !threadTs || event.user === process.env.SLACK_BOT_ID) {
        logger.info('slackSupportEvents(): Ignoring event', {
          type,
          isThread: !!threadTs,
          fromUser: event?.user,
          isSelfMention: event?.user === process.env.SLACK_BOT_ID,
        });
        response.status(200).end();
        return;
      }

      // MARK: - Get environment variables

      const configPath = process.env.CONFIG_PATH;
      if (!configPath) {
        sendSlackErrorMessage('Config path is not set');
        logger.error('slackSupportEvents(): Config path is not set', { userId, threadTs, configPath });
        response.status(500).end();
        return;
      }

      // MARK: - Find the user ID

      timings.startTiming('findUserId');
      logger.info('slackSupportEvents(): Finding userId for thread...', { threadTs });
      const configPathSegments = configPath.split('/');
      const userIdIndex = configPathSegments.indexOf('{userId}');
      const lastCollectionSegment = configPathSegments[configPathSegments.length - 2];

      const querySnapshot = await db.collectionGroup(lastCollectionSegment)
        .where('slackThreadTs', '==', threadTs)
        .limit(2) // Query for 2 to check for duplicates
        .get();

      if (querySnapshot.empty) {
        sendSlackErrorMessage('No user found for thread');
        logger.error('slackSupportEvents(): No user found for thread', { threadTs });
        response.status(404).end();
        return;
      }

      if (querySnapshot.size > 1) {
        sendSlackErrorMessage('Multiple users found for thread');
        logger.error('slackSupportEvents(): Multiple users found for thread', {
          threadTs,
          count: querySnapshot.size,
          paths: querySnapshot.docs.map((doc) => doc.ref.path),
        });
        response.status(409).end(); // 409 = Conflict status code
        return;
      }

      // MARK: - Extract userId using the index from CONFIG_PATH

      const supportDoc = querySnapshot.docs[0];
      const pathSegments = supportDoc.ref.path.split('/');
      userId = pathSegments[userIdIndex];
      logger.info('slackSupportEvents(): Found user', { userId, threadTs, event });
      timings.endTiming('findUserId');

      // MARK: - Create a new support message

      timings.startTiming('createSupportMessage');
      const slackTextWithoutBotMention = event.text.replace(`<@${process.env.SLACK_BOT_ID}>`, '').trim();
      const supportMessageDocument: SupportMessageDocument = {
        createdAt: FieldValue.serverTimestamp(),
        message: emojifyMessage(slackTextWithoutBotMention),
        role: SUPPORT_MESSAGE_ROLE.INTERNAL,
        status: SUPPORT_MESSAGE_STATUS.SENT,
        slackThreadTs: threadTs,
        rawMessage: event.text,
      };
      timings.endTiming('createSupportMessage');

      // MARK: - Store support message in Firestore

      timings.startTiming('storeSupportMessage');
      const messagesPath = process.env.MESSAGES_PATH || 'users/{userId}/support/default/messages';
      await db.collection(messagesPath.replace('{userId}', userId))
        .add(supportMessageDocument);
      timings.endTiming('storeSupportMessage');

      // MARK: - Log success

      logger.info('slackSupportEvents(): Successfully created support message', {
        userId,
        threadTs,
        totalDuration: timings.getTotalDurationInMs(),
        timings: timings.getTimings(),
      });

      response.status(200).end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';

      sendSlackErrorMessage(`Error creating support message: ${errorMessage}`);
      logger.error('slackSupportEvents(): Error creating support message', {
        userId,
        threadTs,
        errorMessage,
        stackTrace,
      });
      response.status(500).end();
    }
  });

// =====================================================================================
// ====================== TEST CODE ====================================================
// ====================== Run with: ts-node src/supportFunctions.ts ====================
// =====================================================================================

// This block will only run if the script is run directly (not imported as a module)
/* eslint-disable */
if (require.main === module) {
  async function createTestSupportMessage() {
    const testUserId = 'test-user-id';
    const testSupportMessage: SupportMessageDocument = {
      message: 'Hello support team! I need help with my app. 🦄',
      role: SUPPORT_MESSAGE_ROLE.USER,
      status: SUPPORT_MESSAGE_STATUS.PENDING,
      createdAt: FieldValue.serverTimestamp(),
    };

    try {
      const supportMessageRef = await db
        .collection(`users/${testUserId}/support/default/messages`)
        .add(testSupportMessage);

      console.log('✅ Created test support message:', supportMessageRef.id);
    } catch (error) {
      console.error('❌ Error creating test support message:', error);
    }
  }

  createTestSupportMessage().catch(console.error);
}
/* eslint-enable */
