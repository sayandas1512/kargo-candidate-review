# Kargo Candidate Review

A ranked shortlist and interview-brief tool for Kargo's PM and SPM applicants. The system ranks and explains; Arjun decides. See [`rubric.txt`](./rubric.txt) for the scoring rubric this is built from.

## Stack

Next.js (App Router, TypeScript) · Tailwind · Neon Postgres + Drizzle ORM · Gemini (`@google/genai`) · Resend · Vitest · Vercel

## One-time setup

### 1. Neon project

The Neon project (`dry-pond-05756923`, branch `production`) already exists. From the project root:

```bash
npm i -g neon@latest
neon login          # or: neon profile create agent --mint  (avoids the 60s browser timeout)
neon link --project-id dry-pond-05756923 --branch production -y
```

`neon link` writes a `.neon` file and a local env file with the pooled and direct connection strings. Make sure your `.env.local` ends up with both:

```
DATABASE_URL=...          # pooled (-pooler in the host) -- app runtime
DATABASE_URL_UNPOOLED=...  # direct (no -pooler) -- migrations only
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the blanks:

```bash
cp .env.example .env.local
```

| Variable | Notes |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | From `neon link` (see above) |
| `GEMINI_API_KEY` | From Google AI Studio, project with billing enabled |
| `GEMINI_MODEL` | Current stable Flash model id, e.g. `gemini-3.8-flash` as of Sept 2026 -- check [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models) before deploying, model ids change |
| `RESEND_API_KEY` | From Resend |
| `RESEND_FROM` | Defaults to `onboarding@resend.dev`. Resend's free tier without a verified domain can only deliver to the account owner's address from this sender. |
| `EMAIL_MODE` | `test` (default) or `live`. Keep `test` until you're ready to actually email candidates. |
| `TEST_RECIPIENT_EMAIL` | Where every email goes while `EMAIL_MODE=test` |
| `DASHBOARD_PASSWORD` | The single password gate for the whole app |
| `SHORTLIST_SIZE` | Default `5` |
| `SCORING_PASSES` | Default `2` |

### 3. Database: migrate and seed

Run these locally against Neon **before the first deploy** -- they are not part of the Vercel build:

```bash
npm run db:migrate    # applies drizzle/ migrations via DATABASE_URL_UNPOOLED
npm run seed:rubric    # upserts rubric.seed.json into the rubrics table, activates PM v1 + SPM v1
```

Confirm in the Neon console (or `SELECT role, version, is_active FROM rubrics;`) that both rubrics exist, are active, and their weights sum to 100 -- `seed:rubric` refuses to seed otherwise.

### 4. Install and run

```bash
npm install
npm run dev
```

## Tests and smoke scripts

```bash
npm test               # vitest: redaction, grounding, weighted-total math, tie-break,
                        # canSend matrix, email/brief validators, injection regex,
                        # rubric weight sums, "lib/ai never imports PII" guard

npm run stability       # scores one calibration CV 3x, live Gemini call -- needs GEMINI_API_KEY
npm run calibrate       # scores all 8 calibration hires against the PM rubric, live Gemini call,
                        # PASS when every Exceeds outscores every Meets/Below (in-sample fit check)
npm run injection-fixture  # synthetic CV with an embedded prompt-injection attempt, live Gemini call
```

`stability`, `calibrate`, and `injection-fixture` read straight from `calibration/hires/*.docx` and `rubric.seed.json` -- they do not touch the database, so they work before Neon is linked, as long as `GEMINI_API_KEY` and `GEMINI_MODEL` are set.

## GitHub and Vercel

```bash
gh repo create kargo-hiring-dashboard --private --source=. --remote=origin
git push -u origin main
vercel link
vercel env add DATABASE_URL production preview       # pooled string only -- never DATABASE_URL_UNPOOLED
vercel env add GEMINI_API_KEY production preview
vercel env add GEMINI_MODEL production preview
vercel env add RESEND_API_KEY production preview
vercel env add RESEND_FROM production preview
vercel env add EMAIL_MODE production preview          # keep as "test"
vercel env add TEST_RECIPIENT_EMAIL production preview
vercel env add DASHBOARD_PASSWORD production preview
vercel env add SHORTLIST_SIZE production preview
vercel env add SCORING_PASSES production preview
vercel --prod
```

Pushes to `main` auto-deploy. `EMAIL_MODE` stays `test` on Vercel -- switching to `live` is a deliberate manual step.

## Manual checklist (definition of done)

- [ ] `/login` works with `DASHBOARD_PASSWORD`
- [ ] `/rubric` shows both PM and SPM rubrics, each "sums to 100"
- [ ] `/upload` shows the Gemini billing/privacy attestation before accepting files
- [ ] Upload 3 test CVs (one strong PM, one weak SPM, one ambiguous): personal details land in `candidate_personal_details`; `cv_text_redacted`/`cv_content` contain no name, email, or phone
- [ ] Each candidate has PM and SPM scores, ranked by score on `/`
- [ ] Shortlisted candidates have a 3-sentence brief; every scored candidate has a draft
- [ ] With `EMAIL_MODE=test`, "Confirm & send" delivers to `TEST_RECIPIENT_EMAIL` within 30s with the real name substituted, and the draft's status flips to `sent` in Neon
- [ ] Vercel function logs contain no CV text

## Security notes

- All DB access is server-side via `DATABASE_URL`, which never reaches the client.
- `decisions` and `audit_log` are append-only in the database itself (triggers block UPDATE always, and DELETE unless inside `delete_candidate()`).
- `lib/ai/*` never imports `candidate_personal_details` or the DB client -- identity is passed in by the caller and never sent to Gemini (enforced at runtime by `assertNoPII` in `lib/ai/gemini.ts`, and at test time by `test/no-pii-import.test.ts`).
- The original CV file is served only through the authenticated `/api/candidates/[id]/file` route, never a public URL.
