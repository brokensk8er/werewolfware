// Moderator sign-in: Firebase ID tokens, plus the local-test switch that the
// deployed server refuses.



// Firebase Admin SDK — initialized when FIREBASE_SERVICE_ACCOUNT env var is set
export let firebaseAdminAuth: any = null;

export let firebaseAdminDb: any = null;

export async function initFirebaseAdmin() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    console.warn('[Admin] FIREBASE_SERVICE_ACCOUNT not set — admin auth disabled');
    return;
  }
  try {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    const serviceAccount = JSON.parse(sa);
    const adminApp = initializeApp({ credential: cert(serviceAccount) }, 'admin');
    firebaseAdminAuth = getAuth(adminApp);
    firebaseAdminDb = getFirestore(adminApp);
    console.log('[Admin] Firebase Admin initialized');
  } catch (e) {
    console.error('[Admin] Firebase Admin init failed:', e);
  }
}

// Local test runs only: lets the phone-size check open the moderator page without
// Google sign-in. Refused whenever the server is deployed (Fly sets both of these).
export const TEST_ADMIN_ALLOWED =
  process.env.ALLOW_TEST_ADMIN === '1' &&
  process.env.NODE_ENV !== 'production' &&
  !process.env.FLY_APP_NAME;

export async function verifyAdminToken(token: string): Promise<string | null> {
  if (TEST_ADMIN_ALLOWED && token === 'local-test') return 'local-test-admin';
  if (!firebaseAdminAuth || !firebaseAdminDb) return null;
  try {
    const decoded = await firebaseAdminAuth.verifyIdToken(token);
    const uid: string = decoded.uid;
    const userDoc = await firebaseAdminDb.collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    const data = userDoc.data();
    return data?.isAdmin === true ? uid : null;
  } catch {
    return null;
  }
}
