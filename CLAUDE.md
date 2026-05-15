# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An SMS party bot: send invite blasts to a guest list via Twilio, then let guests chat with a GPT-3.5-turbo bot that hypes the party, shares details, tracks RSVPs, and teases surprises. Conversation history is stored per-guest in Twilio Sync.

## Commands

```bash
npm install          # install dependencies
npm run send         # send invite SMS blast to everyone in guests.json
npm run rsvps        # print RSVP summary pulled from Twilio Sync
npm run dev          # run the function locally at localhost:3000/handler
npm run deploy       # deploy function to Twilio Serverless
```

## One-time setup

1. Copy `.env.example` → `.env` and fill in all values
2. Create a Twilio Sync Service in the Console → copy the SID into `SYNC_SERVICE_SID`
3. Deploy the function: `npm run deploy` — copy the returned URL
4. In Twilio Console → Phone Numbers → your number → Messaging → set the webhook URL to `<deployed-url>/handler` (HTTP POST)
5. Add guests to `guests.json`
6. Run the blast: `npm run send`

## Architecture

**Two pieces:**

- `send-invites.js` — one-shot script, run locally. Loops over `guests.json` and fires individual SMS via Twilio Messaging API.
- `functions/handler.js` — Twilio Serverless Function. Handles every inbound reply: loads conversation history from Twilio Sync, calls OpenAI, writes the reply back as TwiML, saves updated state.

**Conversation state** lives in Twilio Sync Documents, one per guest, keyed `guest-{digits}`. Each document holds `{ phone, rsvp, history[] }`. History is capped at 20 messages; only the last 8 are sent to OpenAI to control cost.

**RSVP detection** is regex-based in the handler (before the OpenAI call). Status is stored in the guest's Sync doc and surfaced via `check-rsvps.js`.

**Party details** (name, date, venue, address, DJs) are all env vars — update `PARTY_*` in `.env` (locally) and in the Twilio Function service config (deployed) to change what the bot knows without touching code.

## Key files

| File | Purpose |
|---|---|
| `functions/handler.js` | Twilio Function — inbound SMS handler |
| `send-invites.js` | Blast script |
| `check-rsvps.js` | RSVP report from Twilio Sync |
| `guests.json` | Guest list `[{ name, phone }]` |
| `.env.example` | All required env vars with descriptions |

## Twilio Function env vars

These must be set both in `.env` (for `npm run dev`) and in the Twilio Console under your Function service (for production):

`OPENAI_API_KEY`, `SYNC_SERVICE_SID`, `PARTY_NAME`, `PARTY_DATE`, `PARTY_VENUE`, `PARTY_ADDRESS`, `PARTY_DJS`
