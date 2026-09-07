const fs = require('fs');

const FB_SYSTEM_TOKEN = process.env.FB_SYSTEM_TOKEN;
const YT_API_KEY = process.env.YT_API_KEY;
const FB_PAGE_ID = "113808195316326";
const IG_BUSINESS_ID = "17841456848505726";
const YT_CHANNEL_1 = "UCFJ-cUZA4bqkyEnSt1HHQyQ";
const YT_CHANNEL_2 = "UCEBIttKTUHQvubz5quNiybA";
const REQUIRED_PER_ACCOUNT = 2;

function getEtNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return { hour: parseInt(get('hour'), 10) };
}

function getEtDayBoundsUtc() {
  const now = new Date();
  const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName').value;
  const offsetMatch = tzName.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : -5;
  const offsetStr = (offsetHours <= 0 ? '+' : '-') + String(Math.abs(offsetHours)).padStart(2, '0') + ':00';
  const startOfDayET = new Date(etDateStr + 'T00:00:00' + offsetStr);
  const endOfDayET = new Date(startOfDayET.getTime() + 24 * 60 * 60 * 1000);
  return { etDateStr, startOfDayET, endOfDayET };
}

async function safeFetchJson(url) {
  const resp = await fetch(url);
  return resp.json();
}

async function checkYouTube(channelId, name, sinceIso, untilIso) {
  try {
    const url = "https://www.googleapis.com/youtube/v3/search?part=id&channelId=" + channelId +
      "&type=video&publishedAfter=" + encodeURIComponent(sinceIso) +
      "&publishedBefore=" + encodeURIComponent(untilIso) + "&key=" + YT_API_KEY;
    const data = await safeFetchJson(url);
    const count = data.pageInfo ? data.pageInfo.totalResults : 0;
    return { name, count, required: REQUIRED_PER_ACCOUNT, passed: count >= REQUIRED_PER_ACCOUNT };
  } catch (err) {
    return { name, error: String(err), passed: false };
  }
}

async function main() {
  const etNow = getEtNow();
  if (etNow.hour !== 16) {
    console.log("Not 4pm ET right now (ET hour = " + etNow.hour + "). Skipping.");
    return;
  }

  const { etDateStr, startOfDayET, endOfDayET } = getEtDayBoundsUtc();
  const sinceUnix = Math.floor(startOfDayET.getTime() / 1000);
  const untilUnix = Math.floor(endOfDayET.getTime() / 1000);
  const sinceIso = startOfDayET.toISOString();
  const untilIso = endOfDayET.toISOString();

  const result = {
    date_checked_et: etDateStr,
    generated_at_utc: new Date().toISOString(),
    accounts: {}
  };

  try {
    const pageTokenData = await safeFetchJson("https://graph.facebook.com/v21.0/" + FB_PAGE_ID + "?fields=access_token&access_token=" + FB_SYSTEM_TOKEN);
    const pageToken = pageTokenData.access_token;
    const fbData = await safeFetchJson("https://graph.facebook.com/v21.0/" + FB_PAGE_ID + "/videos?fields=id,created_time&since=" + sinceUnix + "&until=" + untilUnix + "&access_token=" + pageToken);
    const fbCount = (fbData.data || []).length;
    result.accounts.facebook = { name: "Facebook Page (Faith Lutheran Church)", count: fbCount, required: REQUIRED_PER_ACCOUNT, passed: fbCount >= REQUIRED_PER_ACCOUNT };
  } catch (err) {
    result.accounts.facebook = { name: "Facebook Page (Faith Lutheran Church)", error: String(err), passed: false };
  }

  try {
    const igData = await safeFetchJson("https://graph.facebook.com/v21.0/" + IG_BUSINESS_ID + "/media?fields=id,timestamp&since=" + sinceUnix + "&until=" + untilUnix + "&access_token=" + FB_SYSTEM_TOKEN);
    const igCount = (igData.data || []).length;
    result.accounts.instagram = { name: "Instagram (@faithlutheranlouisville)", count: igCount, required: REQUIRED_PER_ACCOUNT, passed: igCount >= REQUIRED_PER_ACCOUNT };
  } catch (err) {
    result.accounts.instagram = { name: "Instagram (@faithlutheranlouisville)", error: String(err), passed: false };
  }

  result.accounts.youtube_faith_lutheran = await checkYouTube(YT_CHANNEL_1, "YouTube (Faith Lutheran Church)", sinceIso, untilIso);
  result.accounts.youtube_alien_righteousness = await checkYouTube(YT_CHANNEL_2, "YouTube (Alien Righteousness)", sinceIso, untilIso);

  const keys = Object.keys(result.accounts);
  result.all_passed = keys.every(k => result.accounts[k].passed === true);
  result.failed_accounts = keys
    .filter(k => result.accounts[k].passed !== true)
    .map(k => {
      const a = result.accounts[k];
      return a.name + (a.error ? " (error: " + a.error + ")" : " (posted " + a.count + " of " + a.required + ")");
    });

  fs.writeFileSync('status.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
