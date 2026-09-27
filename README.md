# Babino Moda Operations Web App

Web app version of the advertising, orders, and profitability tracker.

## What it covers

- Campaign master data and performance verdicts.
- Daily ad spend and platform metrics.
- Orders with customers, addresses, editable status, and multiple line items.
- Product and size performance for next-season planning.
- Supabase schema with row-level security for shared team access.
- Cloudflare Pages-ready React/Vite build.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   copy .env.example .env.local
   ```

3. Run locally:

   ```bash
   npm run dev
   ```

Without Supabase variables, the app runs with demo data in local storage. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to connect it to Supabase. `VITE_SUPABASE_ORG_ID` is optional; if it is empty, the app uses the first workspace the signed-in user belongs to.

## Supabase

Run `supabase/migrations/0001_initial_schema.sql` in the Supabase SQL editor or apply it as a migration. The first user can create the `Babino Moda` workspace from the app; the database trigger adds that user as `owner` automatically.

To add the second user, invite/sign them into Supabase Auth, then add them to `organization_members` with the workspace `organization_id` and their `auth.users.id`.

## Cloudflare Pages

Use GitHub as the source repository, then configure Cloudflare Pages with:

- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

Add the same `VITE_` environment variables in Cloudflare Pages project settings.

## GitHub

This folder is a standalone Git project. After creating an empty GitHub repository:

```bash
git remote add origin https://github.com/<your-user>/<repo-name>.git
git branch -M main
git add .
git commit -m "Build Babino Moda operations web app"
git push -u origin main
```
