import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK and Firestore
initializeApp();
export const db = getFirestore();

import { onSupportMessageCreated, slackSupportEvents } from './supportFunctions';

export { onSupportMessageCreated, slackSupportEvents };
