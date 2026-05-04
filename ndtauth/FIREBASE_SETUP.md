# Firebase Setup Guide — No Dice Poll Tool

This guide walks you through creating a free Firebase project, wiring it into `poll.html`, and testing everything before show night. It assumes no prior Firebase experience.

---

## What Firebase does here

`poll.html` needs a single shared database that all devices — the showrunner's phone and every audience member's phone — can read and write simultaneously in real time. Firebase Realtime Database does exactly this, for free, with no server to manage. Google hosts it; you just give `poll.html` a set of credentials so it knows which database to talk to.

---

## Part 1 — Create a Firebase project

### Step 1 — Sign in to Firebase

Go to **https://console.firebase.google.com**

Sign in with any Google account. This doesn't need to be a special account — a personal Gmail is fine.

### Step 2 — Create a new project

Click the large **"Add project"** card (or **"Create a project"** button).

You'll be walked through three screens:

**Screen 1 — Name your project**
- Type any name, e.g. `no-dice` or `improv-dnd-poll`
- The project ID underneath will be auto-generated (e.g. `no-dice-a3f9b`) — this becomes part of your database URL. You can edit it here if you want something cleaner, but it doesn't matter much
- Click **Continue**

**Screen 2 — Google Analytics**
- You can toggle this off — you don't need analytics for a poll tool
- Click **Create project**

**Screen 3 — Your project is ready**
- Wait a few seconds for it to provision
- Click **Continue**

You'll land on the Firebase project dashboard.

---

## Part 2 — Create the Realtime Database

This is the actual database that stores votes.

### Step 3 — Open Realtime Database

In the left sidebar, click **Build** to expand it, then click **Realtime Database**.

If you don't see the sidebar, click the hamburger menu (≡) at the top left.

### Step 4 — Create the database

Click **Create Database**.

**Location prompt:**
- Choose the region closest to where your shows happen
- United States: `us-central1`
- Europe: `europe-west1`
- Asia/Pacific: `asia-southeast1`
- Click **Next**

**Security rules prompt:**
- Select **"Start in test mode"**
- This means anyone with your database URL can read and write — which is exactly what you need for a show where audience members vote without logging in
- Click **Enable**

You'll now see your empty database, with a URL that looks like:
```
https://no-dice-a3f9b-default-rtdb.firebaseio.com/
```
**Copy this URL — you'll need it later.**

### Step 5 — Confirm the security rules

Click the **Rules** tab at the top of the Realtime Database page.

You should see:
```json
{
  "rules": {
    ".read": "now < 1234567890000",
    ".write": "now < 1234567890000"
  }
}
```

The timestamp is 30 days from now — test mode expires automatically. For a permanent setup, replace this with:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Click **Publish** after making any changes.

> **A note on security:** These open rules are fine for an improv show. The database only ever stores a poll question, two options, and anonymous vote counts. There's nothing sensitive here. If you want to lock it down further after the project, the Firebase documentation has a guide on granular rules.

---

## Part 3 — Register a web app and get your config

Firebase needs to know a web page is connecting to it. You register an "app" to get a config object with your project's credentials.

### Step 6 — Go to Project Settings

Click the **gear icon (⚙)** next to "Project Overview" in the top-left of the sidebar.

Select **Project settings**.

### Step 7 — Add a web app

Scroll down to the **"Your apps"** section.

Click the web icon — it looks like **`</>`** (a code bracket symbol).

**Register app screen:**
- App nickname: type anything, e.g. `poll`
- Leave "Also set up Firebase Hosting" **unchecked** — you're using GitHub Pages, not Firebase Hosting
- Click **Register app**

### Step 8 — Copy your config object

You'll see a code block that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyC_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "no-dice-a3f9b.firebaseapp.com",
  databaseURL: "https://no-dice-a3f9b-default-rtdb.firebaseio.com",
  projectId: "no-dice-a3f9b",
  storageBucket: "no-dice-a3f9b.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890abcdef"
};
```

**Copy all of this.** Keep it somewhere safe while you do the next step.

Click **Continue to console**.

---

## Part 4 — Paste the config into poll.html

### Step 9 — Open poll.html in a text editor

Open `poll.html` in any text editor — VS Code, Notepad, TextEdit, whatever you have.

Search for this block (it's near the bottom of the file, inside the `<script>` tag):

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
```

### Step 10 — Replace the placeholder values

Replace each `"YOUR_..."` value with the corresponding value from your Firebase config object.

**Before:**
```javascript
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
```

**After (with your real values — these are examples, yours will be different):**
```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain:        "no-dice-a3f9b.firebaseapp.com",
  databaseURL:       "https://no-dice-a3f9b-default-rtdb.firebaseio.com",
  projectId:         "no-dice-a3f9b",
  storageBucket:     "no-dice-a3f9b.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abcdef1234567890abcdef",
};
```

> **Common mistakes to avoid:**
> - Don't remove the quote marks around the values
> - Don't remove the commas at the end of each line
> - Make sure `databaseURL` is present — it's sometimes missing from config snippets copied from newer Firebase consoles. If it's missing from yours, construct it manually: `https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com`

Save the file.

---

## Part 5 — Deploy and test

### Step 11 — Push poll.html to GitHub

Add `poll.html` to your No Dice repo and push it:

```bash
git add poll.html
git commit -m "Add poll tool"
git push
```

GitHub Pages will publish it within 1–2 minutes at:
```
https://yourusername.github.io/your-repo-name/poll.html
```

### Step 12 — Test the setup screen is gone

Open `poll.html` in a browser (the live GitHub Pages URL, not the local file — Firebase connections don't work from `file://` URLs).

If setup is complete, you should see a spinning ⚔ for a moment and then either:
- The showrunner form (if you opened `poll.html?admin`)
- The "Standing by…" audience screen (if you opened `poll.html`)

If you still see the "Firebase Setup Needed" screen, go back and check Step 10 — one of the placeholder values wasn't replaced.

### Step 13 — Test a full poll cycle

Open two browser tabs (or use two devices on the same network):

**Tab 1 — Showrunner:**
```
https://yourusername.github.io/your-repo-name/poll.html?admin
```

**Tab 2 — Audience member:**
```
https://yourusername.github.io/your-repo-name/poll.html
```

**Run through this sequence:**

1. In Tab 1 (admin), type a test question and two options, click **Launch Poll**
2. In Tab 2, confirm the question appears within a second or two
3. In Tab 2, tap one of the vote buttons — you should see "✔ Voted — Waiting for the reveal…"
4. In Tab 1 (admin), confirm the vote count ticks up to 1
5. In Tab 1 (admin), click **🎲 Reveal Results to Audience**
6. In Tab 2, confirm the result bars appear
7. In Tab 1 (admin), click **Close Poll & Clear**
8. In Tab 2, confirm it returns to "Standing by…"

If all 8 steps work, you're fully set up.

---

## Part 6 — Add poll.html to the hub page

### Step 14 — Update index.html

Open `index.html` and find the tool grid. Add a new card for The Poll, or promote an existing coming-soon slot.

Find the tools grid section and add this card (or replace a coming-soon card):

```html
<!-- Poll Tool — ACTIVE -->
<a class="tool-card active" href="poll.html">
  <div class="tool-icon">🗳️</div>
  <div class="tool-name">The Poll</div>
  <div class="tool-desc">The crowd decides. Showrunner reveals.</div>
  <span class="tool-badge badge-ready">Ready</span>
</a>
```

Save and push `index.html`.

---

## Part 7 — Show night setup

### Step 15 — Showrunner bookmark

Before the show, bookmark this URL on your phone or tablet:
```
https://yourusername.github.io/your-repo-name/poll.html?admin
```

Nobody in the audience needs to know the `?admin` part exists. Keep this tab open on your device throughout the show.

### Step 16 — Audience access

The audience reaches `poll.html` through the same QR code you already use for the rest of No Dice — they'll land on the hub (`index.html`) and tap The Poll card. Or, if you want to send them directly to the poll page, generate a second QR code for `poll.html` specifically and display it when a vote is coming up.

### Step 17 — Checklist before each show

- [ ] Open `poll.html?admin` on your device and confirm "Connected" badge is green
- [ ] Test one dummy poll from your device and clear it before the audience arrives
- [ ] Confirm the audience-facing URL loads the "Standing by…" screen
- [ ] Have a backup plan ready (verbal show of hands) in case the WiFi is unreliable

---

## Troubleshooting

**"Firebase Setup Needed" screen still appears after adding config**
The code detects placeholder values by checking if any config value starts with `YOUR_`. Search your saved file for `YOUR_` — if any remain, replace them. The most commonly missed one is `databaseURL`.

**Connection Error screen (⚠️)**
- Check your `databaseURL` value is correctly formatted: `https://PROJECT_ID-default-rtdb.firebaseio.com`
- In the Firebase Console, check that Realtime Database is actually enabled (Build → Realtime Database — it should show your database, not a "Get started" button)
- Check your database rules are set to allow `.read: true, .write: true`

**Question launches but audience screen doesn't update**
- The most common cause is a stale browser cache. Have audience members do a hard refresh (hold Shift and tap reload, or close and reopen the tab)
- Also check the Firebase Console → Realtime Database → Data tab. You should see a `nodice` key appear when a poll is launched. If it doesn't appear, the write is failing — re-check your rules

**Votes aren't counting up on the admin screen**
- Open your browser's developer console (F12 → Console tab) on the admin page — Firebase errors will appear there
- The most common cause is the `databaseURL` being missing or wrong in your config

**Database rules expired (30 days after test mode setup)**
Go to Firebase Console → Realtime Database → Rules and update to:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
Then click Publish.

**Someone voted twice (different device)**
Each vote is tied to a `sessionStorage` UUID that's generated per browser tab and cleared when the tab closes. There's no cross-device deduplication — if someone opens the poll on their phone and their partner's phone, both votes count. For a live show this is generally fine; the crowd can self-police.

---

## Firebase free tier limits

The free "Spark" plan is more than enough for show night use:

| Resource | Free limit | Typical show usage |
|---|---|---|
| Simultaneous connections | 100 | Fine for most venues |
| Storage | 1 GB | The poll data is kilobytes |
| Downloads per month | 10 GB | Negligible |
| Uploads per month | Unlimited | — |

You will not be charged anything. Firebase requires a credit card only if you upgrade to the "Blaze" (pay-as-you-go) plan, which you don't need to do.

---

*No Dice — Improv D&D — Firebase Setup Guide*
