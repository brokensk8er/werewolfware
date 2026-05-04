# Firebase Manual Setup Checklist

Two steps required before Google Sign-In works on admin.html.

---

## Step 1 — Enable Google as an Auth Provider

1. Go to https://console.firebase.google.com → select project **nodicetools**
2. Left sidebar → **Build** → **Authentication**
3. Click the **Sign-in method** tab
4. Find **Google** in the list → click it → toggle **Enable** → click **Save**

Verify: Google should now show a green "Enabled" badge in the provider list.

---

## Step 2 — Set isAdmin on Your Firestore User Doc

Your Google account needs a Firestore document with `isAdmin: true`.

### Find your Google UID first:

Option A — sign in once via the live login page (it will fail the admin check but the sign-in still creates a Firebase Auth user). Then:

1. Firebase Console → **Build** → **Authentication** → **Users** tab
2. Find `stopdavidlane@gmail.com` — copy the **User UID** column value

Option B — check the browser console on login.html after a failed sign-in attempt; the uid is logged by Firebase.

### Create/update the Firestore doc:

1. Firebase Console → **Build** → **Firestore Database**
2. Click **+ Start collection** if no `users` collection exists, or click into the existing `users` collection
3. Click **+ Add document** — set the Document ID to the UID you copied above
4. Add these fields:
   - `isAdmin` → **boolean** → `true`
5. Click **Save**

Verify: Refresh admin.html → Google Sign-In popup → sign in as stopdavidlane@gmail.com → should redirect straight to the admin dashboard.

---

## Done? Quick smoke test

- [ ] `login.html` — Google popup appears, sign-in succeeds, redirects to `admin.html`
- [ ] `admin.html` refresh while signed in — goes directly to dashboard (no re-auth)
- [ ] `admin.html` on phone — same Google account recognized, direct access
- [ ] No active game — "No Active Game" panel with Create Game button is visible
- [ ] Create Game → admin panel populates with empty lobby
- [ ] `index.html` — name input only, no room code field, Join Game connects to active game
