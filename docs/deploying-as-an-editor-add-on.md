# Deploying as an Editor Add-on

This guide is for an org admin distributing the SSI Toolkit org-wide as a Google Workspace **Editor add-on** — installed once, available in every Sheet across the organization — without touching any code.

If you just want your own personal copy instead, see the main [README](../README.md#get-your-own-copy) — it's a much shorter path and none of what follows applies.

## What this is

An Editor add-on is installed once by an admin and appears in every user's **Extensions** menu, across every Sheet in the domain. That's different from a **container-bound** script, which is attached to one specific Sheet — like the [template Sheet](../README.md#get-your-own-copy) this project maintains for individual copies. See Google's [Editor add-ons overview](https://developers.google.com/workspace/add-ons/concepts/types#editor-add-ons) for the concepts; the rest of this doc covers what's specific to distributing *this* toolkit that way.

## Set up your project

### 1. Create an Apps Script project

Go to [script.google.com](https://script.google.com/u/0/home/all) and create a new, standalone project. You don't need to enable the Drive Advanced Service by hand — it's already declared in this repo's `appsscript.json`, and `clasp push` (see [Deploy your code](#deploy-your-code) below) carries that declaration over automatically.

### 2. Link your own Google Cloud project

A script's default, Google-managed Cloud project can't back a Marketplace listing. Switch this project to a **standard**, user-owned GCP project before doing anything else here: **Project Settings → Change project**, in the script editor. Follow Google's [Google Cloud projects](https://developers.google.com/apps-script/guides/cloud-platform-projects) guide for the mechanics. Do this early — Google's own docs warn that switching later can force your users to re-authorize.

### 3. Set your Gemini API key

In the script editor: **Project Settings → Script Properties** → add `GEMINI_API_KEY` with your own key. [AI Studio](https://aistudio.google.com/api-keys) makes it easy to mint one and [set a monthly spend cap](https://aistudio.google.com/spend) to avoid surprise billing.

## Set up the Marketplace listing

Enable the Google Workspace Marketplace SDK on your GCP project and configure your listing — see Google's [Marketplace SDK overview](https://developers.google.com/workspace/marketplace/overview) and [Configure your app](https://developers.google.com/workspace/marketplace/enable-configure-sdk) guides for the mechanics.

You don't need to publish publicly: **private publishing** makes your listing immediately available to everyone in your Google Workspace organization, with no Google review step. See [Publish apps to the Google Workspace Marketplace](https://developers.google.com/workspace/marketplace/how-to-publish) for the public/private distinction.

**TK:** a marketplace-listing asset packet (icon, screenshots, promotional copy) for this toolkit doesn't exist yet. Use your own placeholders for now — this is a known gap, not something to block on.

## Deploy your code

You'll need Node.js 22+ and this repo cloned locally. [`clasp`](https://developers.google.com/apps-script/guides/clasp) is included as a devDependency — no global install needed.

**First-time setup:**

```zsh
git clone https://github.com/propublica/gas-ssi-toolkit.git
cd gas-ssi-toolkit
npm install
```

Create `.clasp.json` at the project root, using the Script ID from your project's **Project Settings** (in the script editor):

```zsh
cat > .clasp.json << 'EOF'
{
  "scriptId": "<your-script-id>",
  "rootDir": "./dist"
}
EOF
```

Then authenticate and push:

```zsh
npm run clasp:login    # authenticate with Google
npm run deploy         # build + push to your project
```

Create your first deployment from the Apps Script editor (**Deploy → New deployment**) — see Google's [Create and manage deployments](https://developers.google.com/apps-script/concepts/deployments) guide. Note the deployment ID (also visible later via `npx clasp list-deployments`); you'll reuse it for every future update.

**Every update after that:**

```zsh
npm run deploy                                    # build + push
npx clasp create-version "<description>"          # snapshot a version
npx clasp update-deployment <deployment-id> --versionNumber <version>
```

A simplified script that wraps these steps — like this repo's own `scripts/release.sh` — is a natural follow-up, but doesn't exist yet for distributors. Do this by hand for now.

## The gotcha

`clasp update-deployment` repoints the Apps Script deployment object only — **it does not make the new version live for your Marketplace-installed users.** The Marketplace SDK has its own, separate "Sheets add-on script version" field that must be updated by hand — there's no API for it:

1. Go to your project's Marketplace SDK **App Configuration** page.
2. Under **App Integrations → Sheets add-on**, set **Sheets add-on script version** to the version number from `clasp create-version` above.
3. Click **Save**.

Skip this step and every installed user stays on the previous version, even though the deployment update above reported success.
