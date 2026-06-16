import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, setLogLevel, enableMultiTabIndexedDbPersistence, enableIndexedDbPersistence } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
setLogLevel('error');
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
} as any, firebaseConfig.firestoreDatabaseId);

// Enable Firestore Local / Offline persistence
if (typeof window !== 'undefined') {
  enableMultiTabIndexedDbPersistence(db)
    .catch((err) => {
      if (err.code === 'failed-precondition') {
        // Multiple tabs open, persistence can only be enabled in one tab at a time.
        console.warn('Firestore persistence failed-precondition: multiple tabs open');
      } else if (err.code === 'unimplemented') {
        // The current browser does not support all of the features required to enable persistence
        console.warn('Firestore persistence unimplemented in this browser browser');
        // Fall back to single-tab persistence if multi-tab fails/is unsupported
        enableIndexedDbPersistence(db).catch((singleErr) => {
          console.warn('Single-tab Firestore persistence also failed:', singleErr);
        });
      }
    });
}

export const auth = getAuth(app);

