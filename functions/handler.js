const OpenAI = require('openai');
const { MongoClient } = require('mongodb');

let mongoClient;

// In-memory cache — survives across warm Twilio Function invocations
const CACHE = {
  djs:    { data: null, ts: 0, ttl: 2 * 60 * 60 * 1000 },   // 2 hours
  events: { data: null, ts: 0, ttl: 15 * 60 * 1000 },        // 15 minutes
};

async function getMongoClient(uri) {
  if (!mongoClient) mongoClient = new MongoClient(uri);
  await mongoClient.connect();
  return mongoClient;
}

async function getDJs(uri) {
  if (CACHE.djs.data && Date.now() - CACHE.djs.ts < CACHE.djs.ttl) return CACHE.djs.data;
  const client = await getMongoClient(uri);
  const data = await client.db('djcards').collection('artists')
    .find({}, {
      projection: { djName: 1, genres: 1, stats: 1, skills: 1, socials: 1, editedPhoto: 1, photo: 1, _id: 0 },
    })
    .toArray();
  CACHE.djs = { data, ts: Date.now(), ttl: CACHE.djs.ttl };
  return data;
}

async function getUpcomingEvents(uri, djNames) {
  if (CACHE.events.data && Date.now() - CACHE.events.ts < CACHE.events.ttl) return CACHE.events.data;
  const client = await getMongoClient(uri);
  const aestOffset = 10 * 60 * 60 * 1000;
  const now = new Date();
  const startOfTodayAEST = new Date(Math.floor((now.getTime() + aestOffset) / 86400000) * 86400000 - aestOffset);
  const twoWeeks = new Date(startOfTodayAEST.getTime() + 14 * 24 * 60 * 60 * 1000);
  const events = await client.db('electron').collection('events')
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

  const priority = withFlag.filter(e => e.hasCardDJ);
  const rest = withFlag.filter(e => !e.hasCardDJ).slice(0, 20 - priority.length);
  const data = [...priority, ...rest];
  CACHE.events = { data, ts: Date.now(), ttl: CACHE.events.ttl };
  return data;
}

function formatEvents(events) {
  if (!events.length) return 'No upcoming events found in the next two weeks.';
  return events.map(e => {
    const date = new Date(e.startDate).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' });
    const artists = (e.artists || []).join(', ');
    const price = e.price ? `$${e.price}` : 'free/unknown price';
    const flag = e.hasCardDJ ? ' ★ electron.dance DJ' : '';
    return `${e.title}${flag}\n  ${date} · ${e.location} · ${price}\n  Artists: ${artists}`;
  }).join('\n\n');
}

const SKILL_LABELS = { long_mixes: 'long mixes', cdjs: 'CDJs', vinyl: 'vinyl', ableton: 'Ableton', scratching: 'scratching' };

function formatDJs(djs) {
  return djs.map(dj => {
    const genres = (dj.genres || []).join(' / ');
    const skills = (dj.skills || []).map(s => SKILL_LABELS[s] || s).join(', ');
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

// Detects if the user is asking about Sydney gigs/events
const GIG_INTENT = /\b(gig|gigs|event|events|what'?s on|tonight|this week|this weekend|what'?s happening|show|concert|going out|music scene|anything on)\b/i;

function systemPrompt(ctx, djInfo, eventsInfo) {
  const eventsSection = eventsInfo
    ? `Upcoming Sydney gigs (next 2 weeks):\n${eventsInfo}`
    : `Upcoming Sydney gigs: available on request — fetch them if the user asks what's on.`;

  return `You are a music concierge for the electron.dance community in Sydney. You have four things to offer — weave them naturally into conversation based on what the person seems interested in:

1. A great party coming up: ${ctx.PARTY_NAME} — ${ctx.PARTY_DATE} at ${ctx.PARTY_VENUE}, ${ctx.PARTY_ADDRESS}. This is always your primary recommendation.
2. A roster of local DJs from the electron.dance community — you know their genres, style, and socials, and can speak about them like a fellow selector.
3. A live feed of what's on in Sydney in the next two weeks — gigs, events, venues.
4. A heads up when any electron.dance DJs are playing at those Sydney gigs — those get a warm personal mention.

Early in the conversation, find out what kind of music they're into before recommending anything. Use that to guide which events or DJs you surface.

What's happening at our party:
${ctx.PARTY_SURPRISES}

Our DJs:
${djInfo}

${eventsSection}

Behaviour:
•  Botany View is always the primary pitch — but introduce it when the moment is right, not as the opening line every time
•  Sydney gigs → mention them as if you just know what's on; only surface ones relevant to their taste
•  electron.dance DJs at other gigs → always worth a mention; frame it as "one of ours is playing"
•  DJs → talk like a selector to a selector; specific, informed, understated
•  Directions/address → give plainly, with local familiarity
•  RSVP yes → warm acknowledgement, not celebration
•  RSVP no → lightly persuasive at most; never guilt-heavy

Photos:
•  We have a photo for every DJ on our roster. Use them generously. Send one when: someone asks about a specific DJ, asks what their vibe is, you're recommending them, or someone asks for a photo. End your reply with [PHOTO:DJ Name] using the exact name from the list. One photo per reply. Never mention you're sending it — just send it. Always include text alongside the tag.

Rules:
•  Replies under 2 sentences
•  No emojis unless they use one first
•  Never sound like an ad, promoter, or marketing copy
•  No exaggerated enthusiasm or hype language
•  Prefer specifics over adjectives
•  Keep a little mystery
•  Sound like someone texting between sets, not a brand manager

Tone: Gilles Peterson, early NTS, independent radio energy. Knowledgeable, warm, community-rooted. You're not selling — you're inviting someone into something real. Inform more than persuade. Grounded, not bubbly.`;
}

const RSVP_YES = /\b(yes|yeah|yep|yup|coming|i'm in|count me in|i'll be there|absolutely|definitely|for sure)\b/i;
const RSVP_NO = /\b(no|nope|can't|cannot|not coming|won't make it|can't make it|busy|skip)\b/i;
const PHOTO_TAG = /\[PHOTO:([^\]]+)\]/i;

exports.handler = async function (context, event, callback) {
  const twiml = new Twilio.twiml.MessagingResponse();
  const from = event.From;
  const body = (event.Body || '').trim();
  const docName = `guest-${from.replace(/\D/g, '')}`;

  const wantsGigs = GIG_INTENT.test(body);

  const [djs, twilioClient] = await Promise.all([
    getDJs(context.MONGODB_URI),
    Promise.resolve(context.getTwilioClient()),
  ]);

  const djNames = djs.map(d => d.djName);

  const [upcomingEvents, sync] = await Promise.all([
    wantsGigs ? getUpcomingEvents(context.MONGODB_URI, djNames) : Promise.resolve(null),
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

  if (!rsvp) {
    if (RSVP_YES.test(body)) rsvp = 'yes';
    else if (RSVP_NO.test(body)) rsvp = 'no';
  }

  const eventsInfo = upcomingEvents ? formatEvents(upcomingEvents) : null;

  const openai = new OpenAI({ apiKey: context.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: systemPrompt(context, formatDJs(djs), eventsInfo) },
      ...history.slice(-8),
    ],
    max_tokens: 160,
    temperature: 0.85,
  });

  let reply = completion.choices[0].message.content.trim();

  const photoMatch = reply.match(PHOTO_TAG);
  const photoUrl = photoMatch ? findDJPhoto(djs, photoMatch[1]) : null;
  reply = reply.replace(PHOTO_TAG, '').trim();
  if (!reply && photoUrl) reply = 'Here you go.';

  history.push({ role: 'assistant', content: reply });

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
