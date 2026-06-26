# Sunwise

Sunwise is a full-stack Next.js app that generates personalized daily weather, activity, outfit, and local event recommendations. It combines user preferences, browser or manual location, live forecast data, AI recommendation generation, and optional daily SMS delivery.

![Sunwise desktop dashboard](./sunwise-desktop.png)

## What It Does

- Shows a daily weather dashboard for the user's saved location.
- Supports browser geolocation with reverse geocoded place names.
- Collects summer hobbies, activity intensity, venue preference, budget, accessibility needs, outfit style, and SMS preferences.
- Generates tailored activity recommendations using weather guardrails and optional AI enrichment.
- Suggests what to wear based on weather and user style preferences.
- Discovers nearby local events through Ticketmaster Discovery.
- Sends daily text digests at the user's configured time.
- Provides SMS verification, consent tracking, opt-out handling, and delivery transparency.
- Includes an admin digest dashboard for monitoring scheduled delivery runs.

## Tech Stack

- **Framework:** Next.js App Router
- **Language:** TypeScript
- **Frontend:** React
- **Auth and database:** Supabase Auth and Postgres
- **AI recommendations:** OpenAI API
- **Weather:** Open-Meteo
- **Reverse geocoding:** OpenStreetMap Nominatim
- **Local events:** Ticketmaster Discovery API
- **SMS:** Twilio
- **Cron and hosting:** Vercel

## Key Integrations

| Integration | Purpose |
| --- | --- |
| Supabase | User auth, profiles, preferences, recommendation history, SMS consent, delivery logs |
| OpenAI | AI-enhanced daily recommendation copy and personalization |
| Open-Meteo | Forecast and hourly weather data |
| Nominatim | Browser coordinate to readable location name |
| Ticketmaster Discovery | Local event discovery near the user's location |
| Twilio | Verification codes, daily SMS delivery, inbound STOP/HELP handling |
| Vercel Cron | Scheduled daily digest processing |

## App Routes

- `/` - Main Sunwise dashboard and preference flow
- `/admin` - Admin digest monitoring dashboard

## API Routes

- `POST /api/recommendations` - Generate and save a personalized daily plan
- `GET /api/location/reverse-geocode` - Convert browser coordinates into a readable location label
- `GET /api/sms-status` - Return SMS eligibility, consent, next send, and latest delivery status
- `POST /api/sms-verification/request` - Send a phone verification code
- `POST /api/sms-verification/verify` - Verify code and record SMS consent
- `POST /api/twilio/inbound` - Handle inbound Twilio messages such as STOP and HELP
- `GET /api/daily-digest` - Cron endpoint for due SMS digest delivery
- `GET /api/admin/digest` - Admin digest run and delivery data

## Environment Variables

Create `.env.local` using `.env.example` as the template:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_RECOMMENDATION_MODEL=gpt-5.4-mini
CRON_SECRET=
ADMIN_SECRET=
SMS_VERIFICATION_SECRET=
TICKETMASTER_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=
```

Never commit `.env.local` or production secrets.

## Local Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Build for production:

```bash
npm run build
```

Start the production build locally:

```bash
npm run start
```

## Database

Supabase migrations live in `supabase/migrations`:

- `0001_sunwise_recommendations.sql`
- `0002_allow_user_recommendation_inserts.sql`
- `0003_daily_digest_delivery_logs.sql`
- `0004_daily_digest_run_logs.sql`
- `0005_sms_verification_consent.sql`
- `0006_sms_inbound_messages.sql`
- `0007_profile_location_coordinates.sql`

These migrations create and evolve the tables needed for profiles, preference profiles, saved recommendations, daily delivery logs, digest run logs, SMS verification, consent, inbound messages, and stored location coordinates.

## Daily Digest Pipeline

Vercel Cron calls `/api/daily-digest` every 15 minutes:

```json
{
  "path": "/api/daily-digest",
  "schedule": "*/15 * * * *"
}
```

The route checks which users are due for their configured send time, verifies SMS eligibility and consent, generates or reuses the daily plan, sends the digest through Twilio, and records run and delivery status in Supabase.

## SMS Compliance Notes

Sunwise records:

- Phone verification status
- SMS consent timestamp
- Verified phone number
- SMS enabled state
- STOP opt-out handling
- Latest delivery status

Users must verify their phone and accept the SMS consent text before daily texts can be enabled.

## Deployment

The project is deployed on Vercel and connected to GitHub. Pushing to the main branch triggers a Vercel deployment.

Production configuration requires all environment variables listed above, including Supabase, OpenAI, Ticketmaster, Twilio, cron/admin secrets, and SMS verification secret.

## Project Structure

```text
app/
  api/                 Route handlers for recommendations, SMS, cron, admin, geocoding
  admin/               Admin dashboard
  page.tsx             Main Sunwise dashboard
lib/
  sunwise/             Recommendation, weather, SMS, delivery, events, and AI logic
  supabase/            Supabase browser/server clients
supabase/
  migrations/          Database schema migrations
vercel.json            Vercel Cron configuration
```

## Current Status

Sunwise currently supports authenticated user profiles, saved locations, live weather, AI-assisted recommendations, local event discovery, SMS verification and consent, daily text delivery, delivery status visibility, and admin monitoring.
