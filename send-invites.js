require('dotenv').config();
const twilio = require('twilio');
const guests = require('./guests.json');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function send() {
  for (const { name, phone } of guests) {
    const body = process.env.INVITE_MESSAGE
      .replace('{name}', name)
      .replace('{party}', process.env.PARTY_NAME);

    await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });

    console.log(`Sent to ${name} (${phone})`);
  }

  console.log(`\nDone — ${guests.length} invites sent.`);
}

send().catch(console.error);
