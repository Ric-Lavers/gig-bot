require('dotenv').config();
const twilio = require('twilio');
const { MongoClient } = require('mongodb');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function send() {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const guests = await mongo.db('electron').collection('guests').find({}).toArray();
  await mongo.close();

  for (const { name, phone } of guests) {
    const body = process.env.INVITE_MESSAGE
      .replace('{name}', name)
      .replace('{party}', process.env.PARTY_NAME);

    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });

    console.log(`Sent to ${name} (${phone})`);
  }

  console.log(`\nDone — ${guests.length} invites sent.`);
}

send().catch(console.error);
