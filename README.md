# Romualdo's Catering — Packages & Inquiries

Customer-facing catering site with the 2026 packages, a build-your-own menu with **estimated** pricing, and a staff-only inquiry dashboard.

- **Website:** static files hosted on GitHub Pages (`index.html`, `config.js`, `assets/`)
- **Database:** `romualdos_inquiries.json` in the *Romualdo's Inquiry App* folder on Google Drive
- **Backend:** Google Apps Script (`apps-script/Code.gs`) running under Romualdo's Google account. It saves inquiries, checks staff logins and serves inquiries only to logged-in staff.
- **Staff logins:** the `Romualdos Staff Logins.xlsx` file in the same Drive folder. Passwords are never stored in this repository or in the browser.

## One-time setup (about 10 minutes)

1. **Staff logins:** fill out `Romualdos Staff Logins.xlsx` (one row per staff member) and upload it to the **Romualdo's Inquiry App** folder in Google Drive.
2. **Backend:**
   1. Go to <https://script.google.com>, signed in as romualdoscatering@gmail.com, and click **New project**. Name it *Romualdo's Inquiry API*.
   2. Delete the sample code, paste the full contents of `apps-script/Code.gs`, and click **Save**.
   3. In the function menu at the top, choose **testSetup**, then click **Run**. Approve the access request. If Google shows "Google hasn't verified this app", click **Advanced → Go to Romualdo's Inquiry API**; it's your own script. The log should say *Database OK* and *Staff file OK*.
   4. Click **Deploy → New deployment**, choose the type **Web app**, and set:
      - **Execute as:** Me
      - **Who has access:** Anyone

      Then click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
3. **Connect the website:** on GitHub, open `config.js`, click the ✏️ pencil, replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the URL, and click **Commit changes**. The site updates in about a minute.
4. **GitHub Pages** (if not already on): open the repository's **Settings → Pages**, set Source to *Deploy from a branch*, Branch to `main` and folder to `/ (root)`, then click **Save**.

## Everyday use

- **Customers** use the site link. Inquiries go straight into the Drive JSON file.
- **Staff** click **Staff login** at the bottom of the page (or add `#staff` to the link).
  - **Staff** accounts can view inquiries, change status and download the Excel file (one sheet per customer).
  - **Admin** accounts can also delete inquiries and edit custom-menu rates.
- **Add, remove or block staff:** edit the Excel file and upload the new version to the Drive folder (*Manage versions* keeps the same file). Set **Active = No** to block someone; it takes effect on their next action.
- **Changing `Code.gs` later:** after pasting the new code, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

All prices shown on the site are estimates only. Final prices are confirmed in a formal quotation.
