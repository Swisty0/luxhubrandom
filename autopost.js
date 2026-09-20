process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

require("dotenv").config();
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  Events,
  AttachmentBuilder,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const VIDEOS_PER_RUN = 10;
const INTERVAL_MS = 60 * 60 * 1000; // 1 saat

const TAGS = [
  "ass", "booty", "boobs", "tits", "pussy", "anal", "blowjob",
  "cum", "milf", "feet", "thighs", "thick", "asian", "latina",
  "ebony", "solo", "gonewild", "facial", "pawg", "cosplay",
];

const sentIds = new Set();
let redgifsToken = null;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function getRedGifsToken() {
  const res = await fetch("https://api.redgifs.com/v2/auth/temporary", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const data = await res.json();
  redgifsToken = data.token;
}

async function searchRedGifs(tag, count = 30) {
  if (!redgifsToken) await getRedGifsToken();

  const url = `https://api.redgifs.com/v2/gifs/search?tags=${encodeURIComponent(tag)}&order=top&count=${count}&type=g`;

  let res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${redgifsToken}`,
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (res.status === 401) {
    await getRedGifsToken();
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${redgifsToken}`,
        "User-Agent": "Mozilla/5.0",
      },
    });
  }

  if (!res.ok) throw new Error(`RedGifs ${res.status}`);
  const data = await res.json();

  return (data.gifs || [])
    .map((g) => {
      const mediaUrl = g.urls?.hd || g.urls?.sd || null;
      return mediaUrl
        ? { id: g.id, title: g.title || tag, url: mediaUrl, tag }
        : null;
    })
    .filter(Boolean);
}

async function downloadVideo(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error("İndirme hatası");
  return Buffer.from(await res.arrayBuffer());
}

function pickRandomTag() {
  return TAGS[Math.floor(Math.random() * TAGS.length)];
}

async function postOneVideo(channel) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tag = pickRandomTag();
    let gifs;

    try {
      gifs = await searchRedGifs(tag);
    } catch (e) {
      console.log("Arama hatası:", e.message);
      continue;
    }

    gifs = gifs.filter((g) => g.id && !sentIds.has(g.id));
    if (!gifs.length) continue;

    gifs.sort(() => Math.random() - 0.5);

    for (const gif of gifs.slice(0, 6)) {
      try {
        const buffer = await downloadVideo(gif.url);
        if (buffer.length > 95 * 1024 * 1024) continue;

        sentIds.add(gif.id);

        const file = new AttachmentBuilder(buffer, {
          name: `${tag}-${Date.now()}.mp4`,
        });

        // Sadece video — ekstra mesaj yok
        await channel.send({ files: [file] });
        return true;
      } catch (e) {
        console.log("Video atlanıyor:", e.message);
        continue;
      }
    }
  }
  return false;
}

async function runHourlyPost() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) {
      console.error("Kanal bulunamadı. CHANNEL_ID kontrol et.");
      return;
    }
    if (!channel.nsfw) {
      console.error("Kanal NSFW değil.");
      return;
    }

    console.log(`[${new Date().toISOString()}] Saatlik post: ${VIDEOS_PER_RUN} video`);

    let ok = 0;
    for (let i = 0; i < VIDEOS_PER_RUN; i++) {
      const success = await postOneVideo(channel);
      if (success) {
        ok++;
        console.log(`  ${ok}/${VIDEOS_PER_RUN} gönderildi`);
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        console.log(`  ${i + 1}. video bulunamadı`);
      }
    }

    console.log(`Bitti: ${ok}/${VIDEOS_PER_RUN}`);
  } catch (err) {
    console.error("Saatlik post hatası:", err.message);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ AutoPost bot: ${client.user.tag}`);

  try {
    await getRedGifsToken();
    console.log("RedGifs token alındı");
  } catch (e) {
    console.error("RedGifs token hatası:", e.message);
  }

  // Açılışta bir kez çalıştır
  await runHourlyPost();

  // Her 1 saatte bir
  setInterval(runHourlyPost, INTERVAL_MS);
  console.log("Zamanlayıcı aktif (1 saat).");
});

// Render ping
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("AutoPost bot aktif ✅");
  })
  .listen(PORT, () => console.log(`HTTP :${PORT}`));

client.login(TOKEN);
