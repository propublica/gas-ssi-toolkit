# SSI Toolkit

A Google Sheets add-on for AI-assisted investigations.

Built with TypeScript, bundled by Rollup, and deployed via clasp.

> **Note:** Avoid making changes in the online Apps Script editor — they will be overwritten on the next deploy.

## Prerequisites

- A Google account
- Node.js 22+
- Apps Script API enabled at [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
- A Gemini API key — [get one here](https://ai.google.dev/gemini-api/docs/api-key)

`@google/clasp` is included as a devDependency — no global install needed.

## Deployment

If you're looking for an SSI Toolkit usage guide, check out our [user onboarding documentation](./docs/user-guide.md).

### 1. Create an Apps Script project

The toolkit can run as either a [Container-bound Script](https://developers.google.com/apps-script/guides/bound) (attached to a specific Sheet) or an [Editor add-on](https://developers.google.com/workspace/add-ons/concepts/types#editor-add-ons) (deployable org-wide). **If you are exploring this project for the first time or installing the SSI Toolkit for personal use, we recommend starting with a Container-bound Script before graduating to an Editor Add-on.**

Follow Google's instructions to create your Apps Script project, then find it at [script.google.com](https://script.google.com/u/0/home/all).

### 2. Enable the Drive Advanced Service

In the script editor: **Editor** → **Services** → find **Drive API** → select **V3** → **Add**.

### 3. Set your Gemini API key

In the script editor: **Project Settings** → **Script Properties** → add `GEMINI_API_KEY` with your API key. This key will only be visible to users with Editor access to your Google Sheet (Container-bound script) or Editor access to your Apps Script Project (Editor Add on).

### 4. Get the script ID

In the script editor: **Project Settings** → copy the **Script ID**.

### 5. Create `.clasp.json`

At the project root:

```zsh
cat > .clasp.json << 'EOF'
{
  "scriptId": "<your-script-id>",
  "rootDir": "./dist"
}
EOF
```

### 6. Install and deploy

```zsh
npm install
npm run clasp:login    # authenticate with Google
npm run deploy         # build + push to Apps Script
```

If running as a container bound script, the toolkit should appear as a menu option automatically in your attached sheet. If you are running it as a standalone Apps Script project and Editor add-on, you'll need to create [a test deployment](https://developers.google.com/workspace/add-ons/how-tos/testing-editor-addons) to see the app in action.

## Development

```bash
# Build
npm run build               # clean build to dist/
npm run build:watch         # rebuild on file changes

# Deploy
npm run deploy              # build + push to HEAD (development)
npm run deploy:watch        # continuous build + push

# Test
npm test                    # run all tests
npm run test:watch          # watch mode
npm run test:coverage       # with per-file coverage thresholds

# Quality
npm run lint                # ESLint
npm run typecheck           # type-check without building
npm run format:check        # check Prettier formatting

# Utilities
npm run clasp:open          # open Apps Script editor in browser
npm run clasp:logs          # tail execution logs
```

## Further Reading

- [Architecture](docs/architecture.md) — server/client split, build pipeline, tool system
- [Contributing](CONTRIBUTING.md) — testing patterns, code style, how to add features
- [Releasing](docs/releasing.md) — deployment lifecycle and release process
- [User Guide](docs/user-guide.md) — basic usage guidance
