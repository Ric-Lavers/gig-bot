const OpenAI = require('openai');
const { MongoClient } = require('mongodb');

let mongoClient;

async function getDJs(uri) {
  if (!mongoClient) mongoClient = new MongoClient(uri);
  await mongoClient.connect();
  return mongoClient.db('djcards').collection('artists')
    .find({}, {
      projection: { djName: 1, genres: 1, stats: 1, skills: 1, socials: 1, _id: 0 },
    })
    .toArray();
}

const SKILL_LABELS = { long_mixes: 'long mixes', cdjs: 'CDJs', vinyl: 'vinyl', ableton: 'Ableton', scratching: 'scratching' };

function formatDJs(djs) {
  return djs.map(dj => {
    const genres = (dj.genres || []).join(' / ');
    const skills = (dj.skills || [])
      .map(s => SKILL_LABELS[s] || s)
      .join(', ');
    const { bpm, danceabilityScale, yearsPlaying } = dj.stats || {};
    const socials = Object.entries(dj.socials || {})
      .filter(([, v]) => v)
      .map(([platform, handle]) => `${platform}: ${handle}`)
      .join(', ');

    return [
      `${dj.djName} — ${genres}`,
      skills && `Skills: ${skills}`,
      bpm && `BPM: ${bpm}`,
      danceabilityScale && `Danceability: ${danceabilityScale}/100`,
      yearsPlaying && `${yearsPlaying} years playing`,
      socials && `Find them: ${socials}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function systemPrompt(ctx, djInfo) {
  return `You are the official hype bot for ${ctx.PARTY_NAME} — ${ctx.PARTY_DATE} at ${ctx.PARTY_VENUE}.
Your job: get people hyped, answer questions, drop hints, and make them feel like they'd be crazy to miss this.

Facts you can share freely:
- Venue: ${ctx.PARTY_VENUE}, ${ctx.PARTY_ADDRESS}
- Date/time: ${ctx.PARTY_DATE}

What's on (tease these — build hype, don't list everything at once):
${ctx.PARTY_SURPRISES}

DJs playing:
${djInfo}

How to handle things:
- Directions/address → share it, make King St Newtown sound like the place to be
- DJs → hype them up using what you know about them, make it feel unmissable
- What's on → reveal things slowly, keep them curious, one thing at a time
- RSVP yes → celebrate with them, big energy
- RSVP no → try to change their mind, playfully guilt them
- Anything else → keep it fun, stay in character

Rules: Keep replies SHORT — 2 sentences max. This is SMS. No emojis unless they used one first.


Personality: Channel the energy of Gilles Peterson — knowledgeable, warm, community-rooted.
You care about the music and the people. You're not selling — you're inviting someone into something
real, at the beginning of something. Inform more than persuade. Keep it grounded, not bubbly.
`;
}

const RSVP_YES = /\b(yes|yeah|yep|yup|coming|i'm in|count me in|i'll be there|absolutely|definitely|for sure)\b/i;
const RSVP_NO = /\b(no|nope|can't|cannot|not coming|won't make it|can't make it|busy|skip)\b/i;

exports.handler = async function (context, event, callback) {
  const twiml = new Twilio.twiml.MessagingResponse();
  const from = event.From;
  const body = (event.Body || '').trim();
  const docName = `guest-${from.replace(/\D/g, '')}`;

  const [djs, twilioClient] = await Promise.all([
    getDJs(context.MONGODB_URI),
    Promise.resolve(context.getTwilioClient()),
  ]);

  const sync = twilioClient.sync.v1.services(context.SYNC_SERVICE_SID);

  // Load existing conversation state
  let history = [];
  let rsvp = null;
  try {
    const doc = await sync.documents(docName).fetch();
    history = doc.data.history || [];
    rsvp = doc.data.rsvp || null;
  } catch (_) {
    // First message from this guest
  }

  history.push({ role: 'user', content: body });

  // Detect RSVP before calling the model
  if (!rsvp) {
    if (RSVP_YES.test(body)) rsvp = 'yes';
    else if (RSVP_NO.test(body)) rsvp = 'no';
  }

  const openai = new OpenAI({ apiKey: context.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: systemPrompt(context, formatDJs(djs)) },
      ...history.slice(-8),
    ],
    max_tokens: 160,
    temperature: 0.85,
  });

  const reply = completion.choices[0].message.content.trim();
  history.push({ role: 'assistant', content: reply });

  // Persist state to Twilio Sync
  const data = { phone: from, rsvp, history: history.slice(-20) };
  try {
    await sync.documents(docName).update({ data });
  } catch (_) {
    await sync.documents.create({ uniqueName: docName, data });
  }

  twiml.message(reply);
  callback(null, twiml);
};
