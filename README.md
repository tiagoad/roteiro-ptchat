# Dependencies

Install dependencies with `pnpm i`. You will need [pnpm](https://pnpm.io/installation).

# Secrets

Some secrets are needed to work in this app. To set up local secrets:

1. Copy the file `.dev.vars.example` into `.dev.vars`.
2. Set `GOOGLE_API_KEY` to a Google Cloud API key with access to the Sheets and Places APIs.
3. Set `GOOGLE_SHEET_ID` to the ID of the database sheet. This is the code after `/spreadsheets/d/` in the URL.

# Development

Run the development server with `pnpm dev`.
