require('dotenv').config();
const twilio = require('twilio');
const guests = require('./guests.json');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function checkRsvps() {
  const docs = await client.sync.v1
    .services(process.env.SYNC_SERVICE_SID)
    .documents.list();

  const byPhone = {};
  for (const doc of docs.filter(d => d.uniqueName.startsWith('guest-'))) {
    const { phone, rsvp } = doc.data;
    if (phone) byPhone[phone] = rsvp || 'pending';
  }

  const yes = [], no = [], pending = [];
  for (const { name, phone } of guests) {
    const status = byPhone[phone];
    const label = `${name} (${phone})`;
    if (status === 'yes') yes.push(label);
    else if (status === 'no') no.push(label);
    else pending.push(label);
  }

  console.log(`\nRSVP Summary — ${new Date().toLocaleString()}`);
  console.log(`Coming     (${yes.length}): ${yes.join(', ') || 'none'}`);
  console.log(`Not coming (${no.length}): ${no.join(', ') || 'none'}`);
  console.log(`No reply   (${pending.length}): ${pending.join(', ') || 'none'}`);
}

checkRsvps().catch(console.error);
