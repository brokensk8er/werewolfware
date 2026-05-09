// Firebase Auth Stub for ndtauth
// This stub initializes Firebase with the config from nodicedataset
// and provides basic auth setup checks.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// Firebase configuration (copied from nodicedataset)
const firebaseConfig = {
  apiKey: "AIzaSyAXcvi644izGZhK8nPGlkfV4vAc3ZWPH8w",
  authDomain: "nodicetools.firebaseapp.com",
  databaseURL: "https://nodicetools-default-rtdb.firebaseio.com",
  projectId: "nodicetools",
  storageBucket: "nodicetools.firebasestorage.app",
  messagingSenderId: "387258889697",
  appId: "1:387258889697:web:5467488ab109ea67b74ea0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Auth state check function
export function checkAuthState(callback) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // User is signed in
      callback({ authenticated: true, user: user });
    } else {
      // User is signed out
      callback({ authenticated: false, user: null });
    }
  });
}

// Example usage:
// checkAuthState((state) => {
//   if (state.authenticated) {
//     console.log('User is logged in:', state.user.email);
//   } else {
//     console.log('User is not logged in');
//   }
// });

export async function signIn(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

export async function signOut() {
  await firebaseSignOut(auth);
}

// Ensure firestore.rules and database.rules.json are applied in Firebase console.