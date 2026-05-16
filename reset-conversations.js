require('dotenv').config();
const fs = require('fs');
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const sync = client.sync.v1.services(process.env.SYNC_SERVICE_SID);

async function run() {
  const docs = await sync.documents.list();
  const guestDocs = docs.filter(d => d.uniqueName.startsWith('guest-'));

  const snapshot = guestDocs.map(d => ({ id: d.uniqueName, ...d.data }));
  const filename = `conversations-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(filename, JSON.stringify(snapshot, null, 2));
  console.log(`Backed up ${snapshot.length} conversations → ${filename}`);

  for (const doc of guestDocs) {
    await sync.documents(doc.uniqueName).update({ data: { phone: doc.data.phone, rsvp: null, history: [] } });
    console.log('Reset:', doc.uniqueName);
  }

  console.log(`Done — ${guestDocs.length} conversations cleared.`);
}

run().catch(console.error);
