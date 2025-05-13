import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { GoogleAuth } from "google-auth-library";
import { logger } from 'firebase-functions';

/**
 * Lifecycle task (`taskQueueTrigger`) that creates a composite index on the
 * `support` collection group for the `slackThreadTs` field.
 *
 * • Runs once at extension install.  
 * • Ignores `ALREADY_EXISTS` errors to keep the install idempotent.
 */
export const createSupportIndex = onTaskDispatched(
  { 
    retryConfig: { maxAttempts: 3 } 
  },
  async () => {
    logger.info('createSupportIndex(): Function started');

    // MARK: - Get environment variables

    const projectId = process.env.GCP_PROJECT ?? process.env.PROJECT_ID;
    const configPath = process.env.CONFIG_PATH;
    if (!projectId || !configPath) {
      logger.error('createSupportIndex(): Project ID or config path is not set', { projectId, configPath });
      return;
    }

    const configSegments = configPath.split('/');
    const lastCollection = configSegments[configSegments.length - 2];
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${lastCollection}/indexes`;

    // MARK: - Composite index definition

    const body = {
      fields: [
        { fieldPath: "slackThreadTs", order: "ASCENDING" },
        { fieldPath: "__name__", order: "ASCENDING" }
      ],
      queryScope: "COLLECTION_GROUP"
    };

    // MARK: - Acquire an access token and call Firestore Admin REST API

    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const client = await auth.getClient();

    // MARK: - Send the request

    try {
      await client.request({ url, method: "POST", data: body });
      logger.info(`createSupportIndex(): Support index creation request sent for collection group '${lastCollection}'`);
    } catch (err: any) {
      // 409 == ALREADY_EXISTS; any other status re‑throws to let the task retry
      if (err.response?.status === 409) {
        logger.info("createSupportIndex(): Support index already exists – nothing to do");
      } else {
        logger.error("createSupportIndex(): Index creation failed", err.response?.data ?? err);
        throw err; // triggers task retry / surfacing to installer
      }
    }
  });
