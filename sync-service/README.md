# Secure mobile sync gateway

This Worker gives the phone editor access to canonical `content/` files in the
portfolio repository. It does **not** expose a GitHub personal access token,
GitHub App private key, deployment hook, workflow files, or generated output
to either client.

## One-time deployment

1. Create a GitHub App owned by the account/organization that owns this repo.
   Give it **Contents: Read and write** repository permission, install it only
   on `AHMarius/ahmarius.github.io`, and record its App ID and installation ID.
2. Create a Cloudflare KV namespace and put its id in `wrangler.toml`.
3. Set Worker secrets (never commit them):

   ```sh
   cd sync-service
   npx wrangler secret put GITHUB_APP_ID
   npx wrangler secret put GITHUB_INSTALLATION_ID
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY
   npx wrangler secret put SYNC_ADMIN_SECRET
   npx wrangler deploy
   ```

   `SYNC_ADMIN_SECRET` must be a random value of at least 32 bytes. It is used
   by the desktop app only to make one-time phone-pairing codes; it is never
   entered on the phone or committed to this repository.
4. Set the deployed Worker URL in Content Studio Settings. Create a pairing
   code on the laptop and claim it on the phone. The claimed mobile session is
   opaque, revocable, and expires after 30 days.

## API contract

- `GET /v1/health` — deployment health check.
- `POST /v1/pairings` — desktop-only, requires the admin secret; creates a
  one-time code valid for 10 minutes.
- `POST /v1/pairings/claim` — exchanges the code for an opaque mobile session.
- `GET /v1/tree` — lists canonical source files available to the remote editor.
- `DELETE /v1/sessions/current` — immediately revokes the caller's session.
- `GET|PUT|DELETE /v1/content/<canonical-content-path>` — mobile content
  access. Writes require the GitHub file SHA, so remote edits become visible as
  a conflict instead of being overwritten silently.

Phone edits write canonical source to `main`, but they do not publish the live
site. The gateway never writes generated files. Open Content Studio on the
desktop and press **Publish** to validate, build, and deploy the `gh-pages`
snapshot.
