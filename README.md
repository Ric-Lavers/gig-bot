# gig-bot

An SMS party bot built on Twilio Serverless + OpenAI. Sends invite blasts to a guest list, then lets guests chat with a bot that hypes the event, shares DJ info, sends DJ card photos via MMS, tracks RSVPs, and teases surprises. Conversation history is stored per-guest in Twilio Sync.

## Stack

- **Twilio Serverless** — inbound SMS handler
- **Twilio Sync** — per-guest conversation state
- **OpenAI GPT-3.5-turbo** — conversational bot
- **MongoDB** — DJ roster with genres, stats, skills, socials, and photos

## Setup

1. Clone the repo
2. Copy `.env.example` → `.env` and fill in all values
3. Create a Twilio Sync Service → copy the SID into `SYNC_SERVICE_SID`
4. Deploy the function: `npm run deploy` — copy the returned URL
5. In Twilio Console → Phone Numbers → your number → Messaging → set webhook to `<url>/handler` (HTTP POST)
6. Add guests to `guests.json`
7. Send the blast: `npm run send`

## Commands

```bash
npm install       # install dependencies
npm run send      # blast invites to everyone in guests.json
npm run rsvps     # print RSVP summary from Twilio Sync
npm run dev       # run handler locally at localhost:3000/handler
npm run deploy    # deploy to Twilio Serverless
```

## Environment variables

Set these in `.env` (local) and in the Twilio Console under your Function service (production):

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Your Twilio SMS number |
| `MONGODB_URI` | MongoDB connection string |
| `SYNC_SERVICE_SID` | Twilio Sync Service SID |
| `OPENAI_API_KEY` | OpenAI API key |
| `PARTY_NAME` | Event name |
| `PARTY_DATE` | Event date/time |
| `PARTY_VENUE` | Venue name |
| `PARTY_ADDRESS` | Venue address |
| `PARTY_SURPRISES` | Comma-separated list of surprises to tease |
| `INVITE_MESSAGE` | Initial SMS blast copy (`{name}` and `{party}` are replaced per guest) |

## How it works

- `send-invites.js` — one-shot script, loops over `guests.json` and fires individual SMS
- `functions/handler.js` — Twilio Serverless Function, handles every inbound reply
- `check-rsvps.js` — prints RSVP summary pulled from Twilio Sync

Conversation state lives in Twilio Sync Documents, one per guest, keyed `guest-{digits}`. History is capped at 20 messages; only the last 8 are sent to OpenAI. RSVP detection is regex-based before the OpenAI call. When a guest asks about a DJ, the bot sends their photo via MMS automatically.
