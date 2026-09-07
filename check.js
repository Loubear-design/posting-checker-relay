const fs = require('fs');
const https = require('https');

const FB_SYSTEM_TOKEN = process.env.FB_SYSTEM_TOKEN;
const YT_API_KEY = process.env.YT_API_KEY;
const FORCE_RUN = process.env.FORCE_RUN === 'true';

const FB_PAGE_ID = '113808195316326';
const IG_BUSINESS_ID = '17841456848505726';
const YT_CHANNEL_FAITH = 'UCFJ-cUZA4bqkyEnSt1HHQyQ';
const YT_CHANNEL_ALIEN = 'UCEBIttKTUHQvubz5quNiybA';

const REQUIRED_FB_IG = 2;
const REQUIRED_YT = 1;

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Failed to parse JSON from ' + url + ': ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

function getEtParts() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour,
    dateStr: `${map.year}-${map.month}-${map.day}`
  };
}

function getEtOffsetMinutes(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset'
  });
  const parts = fmt.formatToParts(date);
  const tzPart = parts.find((p) => p.type === 'timeZoneName').value;
  const match = tzPart.match(/GMT([+-]\d+)/);
  const offsetHours = match ? parseInt(match[1], 10) : -5;
  return offsetHours * 60;
}

function getEtDayRangeUtc() {
  const now = new Date();
  const { year, month, day } = getEtParts();
  const offsetMin = getEtOffsetMinutes(now);
  const startUtcMs = Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 0, 0, 0) - offsetMin * 60000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return {
    startUtc: new Date(startUtcMs),
    endUtc: new Date(endUtcMs)
  };
}

async function getPageAccessToken() {
  const url = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}?fields=access_token&access_token=${FB_SYSTEM_TOKEN}`;
  const data = await httpGetJson(url);
  if (!data.access_token) {
    throw new Error('Could not derive page access token: ' + JSON.stringify(data));
  }
  return data.access_token;
}

async function checkFacebook(pageToken, startUtc, endUtc) {
  const url = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/videos?fields=id,created_time&limit=50&access_token=${pageToken}`;
  const data = await httpGetJson(url);
  const videos = data.data || [];
  const count = videos.filter((v) => {
    const created = new Date(v.created_time);
    return created >= startUtc && created < endUtc;
  }).length;
  return count;
}

async function checkInstagram(pageToken, startUtc, endUtc) {
  const url = `https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}/media?fields=id,timestamp,media_type&limit=50&access_token=${pageToken}`;
  const data = await httpGetJson(url);
  const media = data.data || [];
  const count = media.filter((m) => {
    const created = new Date(m.timestamp);
    return created >= startUtc && created < endUtc;
  }).length;
  return count;
}

async function checkYouTube(channelId, startUtc, endUtc) {
  const publishedAfter = startUtc.toISOString();
  const publishedBefore = endUtc.toISOString();
  const url = `https://www.googleapis.com/youtube/v3/search?key=${YT_API_KEY}&channelId=${channelId}&part=id&order=date&type=video&maxResults=50&publishedAfter=${publishedAfter}&publishedBefore=${publishedBefore}`;
  const data = await httpGetJson(url);
  const items = data.items || [];
  return items.length;
}

async function main() {
  const et = getEtParts();

  if (et.hour !== 15 && !FORCE_RUN) {
    console.log(`Not the 3pm ET run (current ET hour: ${et.hour}). Skipping.`);
    return;
  }

  const { startUtc, endUtc } = getEtDayRangeUtc();

  const pageToken = await getPageAccessToken();

  const [fbCount, igCount, ytFaithCount, ytAlienCount] = await Promise.all([
    checkFacebook(pageToken, startUtc, endUtc),
    checkInstagram(pageToken, startUtc, endUtc),
    checkYouTube(YT_CHANNEL_FAITH, startUtc, endUtc),
    checkYouTube(YT_CHANNEL_ALIEN, startUtc, endUtc)
  ]);

  const accounts = {
    facebook: {
      name: 'Facebook Page (Faith Lutheran Church)',
      count: fbCount,
      required: REQUIRED_FB_IG,
      passed: fbCount >= REQUIRED_FB_IG
    },
    instagram: {
      name: 'Instagram (@faithlutheranlouisville)',
      count: igCount,
      required: REQUIRED_FB_IG,
      passed: igCount >= REQUIRED_FB_IG
    },
    youtube_faith_lutheran: {
      name: 'YouTube (Faith Lutheran Church)',
      count: ytFaithCount,
      required: REQUIRED_YT,
      passed: ytFaithCount >= REQUIRED_YT
    },
    youtube_alien_righteousness: {
      name: 'YouTube (Alien Righteousness)',
      count: ytAlienCount,
      required: REQUIRED_YT,
      passed: ytAlienCount >= REQUIRED_YT
    }
  };

  const failedAccounts = Object.values(accounts)
    .filter((a) => !a.passed)
    .map((a) => `${a.name} (posted ${a.count} of ${a.required})`);

  const status = {
    date_checked_et: et.dateStr,
    generated_at_utc: new Date().toISOString(),
    accounts,
    all_passed: failedAccounts.length === 0,
    failed_accounts: failedAccounts
  };

  fs.writeFileSync('status.json', JSON.stringify(status, null, 2));
  console.log(JSON.stringify(status, null, 2));
}

main().catch((err) => {
  console.error('Check failed:', err);
  process.exit(1);
});

