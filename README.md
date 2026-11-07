# Aspire Messenger (Web App)

Works on Android and iPhone from a link. Add it to the home screen and it behaves like an app.
No Android Studio, no builds. Same cards as before: Attendance, Fee, Voucher/Receipt, Exam,
Daily Diary, Homework, Timetable, Notice, Complaint, Leave.

## 1. Firebase (you may have done most of this already)
1. Authentication > Sign-in method > enable **Email/Password**.
2. Firestore Database > Create database (production mode, a location near Pakistan).
3. Firestore > Rules > paste the contents of `firestore.rules` > **Publish**.
4. Project settings (gear) > General > Your apps > click the **web icon `</>`** > register
   the app (name: Aspire Web) > copy the `firebaseConfig` values.
5. Open `firebase-config.js` and paste those values over the PASTE_... placeholders.
6. Create your admin: Authentication > Users > Add user (email + password), copy the User UID.
   Firestore > start collection `users` > document ID = that UID, fields:
   `name` (string), `role` = `ADMIN`, `studentName` = "", `classSection` = "".
   Add teachers (`role` = `TEACHER`) and parents (`role` = `PARENT`, with `studentName` and
   `classSection` like `5-A`) the same way.

## 2. Put it online (free, no tools needed)
GitHub Pages, all in the browser:
1. Make a free account at github.com > **New repository** (name e.g. `aspire`, Public).
2. **Add file > Upload files** > drag in ALL files and the `icons` folder from this folder
   (index.html, app.js, styles.css, sw.js, manifest.webmanifest, firebase-config.js, icons/) > Commit.
3. Repository **Settings > Pages** > Source: *Deploy from a branch*, branch `main`, folder `/ (root)` > Save.
4. After a minute your link appears: `https://<your-username>.github.io/aspire/`
5. Firebase > Authentication > Settings > **Authorized domains** > Add domain
   `<your-username>.github.io`.

(Do not just double-click index.html. It must be opened through a web link.)

Public repository note: the Firebase config values are not secrets and your data is protected by
`firestore.rules`. If you prefer, make the repository private (GitHub Pages on private repos needs a paid plan).

## 3. Install on phones
- **Android (Chrome):** open the link > menu (three dots) > **Add to Home screen / Install app**.
- **iPhone (Safari):** open the link > Share button > **Add to Home Screen**.

## Updating
Edit a file on GitHub (pencil icon) or upload the new version. Phones pick up changes the next time they open the app online.

## Not included yet
- Push notifications (limited on iPhone web apps, and needs a Cloud Function on the paid Firebase plan)
- Photo / PDF attachments
- Urdu / RTL language switch
