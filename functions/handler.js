const OpenAI = require('openai');
const { MongoClient } = require('mongodb');

let mongoClient;

async function getDJs(uri) {
  if (!mongoClient) mongoClient = new MongoClient(uri);
  await mongoClient.connect();
  return mongoClient.db('djcards').collection('artists')
    .find({}, {
      projection: { djName: 1, genres: 1, stats: 1, skills: 1, socials: 1, editedPhoto: 1, photo: 1, _id: 0 },
    })
    .toArray();
}

async function getUpcomingEvents(uri, djNames) {
  if (!mongoClient) mongoClient = new MongoClient(uri);
  await mongoClient.connect();
  const now = new Date();
  const aestOffset = 10 * 60 * 60 * 1000;
  const startOfTodayAEST = new Date(Math.floor((now.getTime() + aestOffset) / 86400000) * 86400000 - aestOffset);
  const twoWeeks = new Date(startOfTodayAEST.getTime() + 14 * 24 * 60 * 60 * 1000);
  const events = await mongoClient.db('electron').collection('events')
    .find({ startDate: { $gte: startOfTodayAEST, $lte: twoWeeks } }, {
      projection: { title: 1, artists: 1, startDate: 1, location: 1, price: 1, url: 1, _id: 0 },
    })
    .sort({ startDate: 1 })
    .toArray();

  const djNamesLower = djNames.map(n => n.toLowerCase());
  const withFlag = events.map(e => {
    const hasCardDJ = (e.artists || []).some(a =>
      djNamesLower.some(dj => a.toLowerCase().includes(dj) || dj.includes(a.toLowerCase()))
    );
    return { ...e, hasCardDJ };
  });

  // Card DJ events first, then the rest — cap total at 20
  const priority = withFlag.filter(e => e.hasCardDJ);
  const rest = withFlag.filter(e => !e.hasCardDJ).slice(0, 20 - priority.length);
  return [...priority, ...rest];
}

function formatEvents(events) {
  if (!events.length) return 'No upcoming events found in the next two weeks.';
  return events.map(e => {
    const date = new Date(e.startDate).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const artists = (e.artists || []).join(', ');
    const price = e.price ? `$${e.price}` : 'free/unknown price';
    const flag = e.hasCardDJ ? ' ★ (features a DJ from our community)' : '';
    return `${e.title}${flag}\n  ${date} · ${e.location} · ${price}\n  Artists: ${artists}`;
  }).join('\n\n');
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

function findDJPhoto(djs, name) {
  if (!name) return null;
  const needle = name.toLowerCase().trim();
  const match = djs.find(dj => dj.djName.toLowerCase().includes(needle) || needle.includes(dj.djName.toLowerCase()));
  if (!match) return null;
  return match.editedPhoto || match.photo || null;
}

function systemPrompt(ctx, djInfo, eventsInfo) {
  return `You are the unofficial voice of ${ctx.PARTY_NAME} — ${ctx.PARTY_DATE} at ${ctx.PARTY_VENUE}.

Your role is to make the night feel culturally real, musically credible, and socially magnetic without sounding promotional.

You're close to the scene. You know the music, know the people, and care about the atmosphere more than turnout numbers.

Share information naturally. Reveal details gradually. Let people feel like they're hearing about something worth being part of, not being sold to.

Facts you can share:
•⁠  ⁠Venue: ${ctx.PARTY_VENUE}, ${ctx.PARTY_ADDRESS}
•⁠  ⁠Date/time: ${ctx.PARTY_DATE}

What's happening:
${ctx.PARTY_SURPRISES}

DJs playing at our event:
${djInfo}

Upcoming Sydney gigs (next 2 weeks):
${eventsInfo}

Behaviour:
•⁠  ⁠Directions/address → give them plainly, with a sense of local familiarity
•⁠  ⁠DJs → talk about them like a selector talking to another selector; specific, informed, understated
•⁠  ⁠What's on → reveal one detail at a time; leave space for curiosity
•⁠  ⁠RSVP yes → warm acknowledgement, not celebration
•⁠  ⁠RSVP no → lightly persuasive at most; never guilt-heavy
•⁠  ⁠Gig recommendations → early in conversation, ask what kind of music they're into before recommending. Our Botany View event is always the primary recommendation. Other Sydney gigs are secondary — mention them naturally if relevant to their taste. Events marked ★ feature someone from our DJ community and should be recommended with extra warmth.
•⁠  ⁠Anything else → stay grounded, socially aware, and concise

Photos:
•⁠  ⁠We have a photo for every DJ. Use them generously — they make the conversation feel real. Send a photo when: someone asks about a specific DJ, someone asks what a DJ sounds like or what their vibe is, you're recommending a DJ, someone expresses curiosity about the lineup, or someone asks for a photo directly. End your reply with [PHOTO:DJ Name] using the exact DJ name from the list. Only one photo per reply. Never mention you're sending a photo — just send it. Always include actual text alongside the tag — never return the tag alone.

Rules:
•⁠  ⁠Replies must stay under 2 sentences
•⁠  ⁠No emojis unless they use one first
•⁠  ⁠Never sound like an ad, nightclub promoter, or marketing copy
•⁠  ⁠Avoid exaggerated enthusiasm or internet hype language
•⁠  ⁠Prefer specifics over adjectives
•⁠  ⁠Keep a little mystery
•⁠  ⁠Sound like someone texting between sets, not a brand manager

Tone reference:
Channel the energy of Gilles Peterson, early NTS, independent radio energy. Calm confidence knowledgeable, warm, community-rooted. You care about the music and the people. You're not selling - you're inviting someone into something real, at the beginning of something. Inform more than persuade. Keep it grounded, not bubbly.`;
}

const RSVP_YES = /\b(yes|yeah|yep|yup|coming|i'm in|count me in|i'll be there|absolutely|definitely|for sure)\b/i;
const RSVP_NO = /\b(no|nope|can't|cannot|not coming|won't make it|can't make it|busy|skip)\b/i;
const PHOTO_TAG = /\[PHOTO:([^\]]+)\]/i;

exports.handler = async function (context, event, callback) {
  const twiml = new Twilio.twiml.MessagingResponse();
  const from = event.From;
  const body = (event.Body || '').trim();
  const docName = `guest-${from.replace(/\D/g, '')}`;

  const [djs, twilioClient] = await Promise.all([
    getDJs(context.MONGODB_URI),
    Promise.resolve(context.getTwilioClient()),
  ]);

  const djNames = djs.map(d => d.djName);
  const [upcomingEvents, sync] = await Promise.all([
    getUpcomingEvents(context.MONGODB_URI, djNames),
    Promise.resolve(twilioClient.sync.v1.services(context.SYNC_SERVICE_SID)),
  ]);

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
      { role: 'system', content: systemPrompt(context, formatDJs(djs), formatEvents(upcomingEvents)) },
      ...history.slice(-8),
    ],
    max_tokens: 160,
    temperature: 0.85,
  });

  let reply = completion.choices[0].message.content.trim();

  // Extract photo tag if present
  const photoMatch = reply.match(PHOTO_TAG);
  const photoUrl = photoMatch ? findDJPhoto(djs, photoMatch[1]) : null;
  reply = reply.replace(PHOTO_TAG, '').trim();
  if (!reply && photoUrl) reply = 'Here you go.';

  history.push({ role: 'assistant', content: reply });

  // Persist state to Twilio Sync
  const data = { phone: from, rsvp, history: history.slice(-20) };
  try {
    await sync.documents(docName).update({ data });
  } catch (_) {
    await sync.documents.create({ uniqueName: docName, data });
  }

  const msg = twiml.message(reply);
  if (photoUrl) msg.media(photoUrl);

  callback(null, twiml);
};
