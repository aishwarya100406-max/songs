// proxy/server.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const multer = require('multer');
const FormData = require('form-data');
const crypto = require('crypto');

const upload = multer();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
  Identify endpoint:
  - Tries ACRCloud (if credentials provided)
  - Falls back to AudD (if AUDD_KEY provided)
  Returns JSON: { provider: 'ACRCloud'|'AudD'|null, result: <provider-specific object> }
*/

// ACRCloud signing helper (REST)
function acrSign(path, accessKey, accessSecret) {
  const http_method = 'POST';
  const data_type = 'audio';
  const signature_version = '1';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = [http_method, path, accessKey, data_type, signature_version, timestamp].join('\n');
  const signature = crypto.createHmac('sha1', accessSecret).update(Buffer.from(stringToSign)).digest('base64');
  return { signature, timestamp };
}

app.post('/identify', upload.single('audio'), async (req, res) => {
  try {
    // ACRCloud attempt
    if(process.env.ACR_HOST && process.env.ACR_ACCESS_KEY && process.env.ACR_ACCESS_SECRET){
      try {
        const path = '/v1/identify';
        const { signature, timestamp } = acrSign(path, process.env.ACR_ACCESS_KEY, process.env.ACR_ACCESS_SECRET);
        const form = new FormData();
        form.append('sample', req.file.buffer, { filename: 'sample.webm' });
        form.append('access_key', process.env.ACR_ACCESS_KEY);
        form.append('data_type', 'audio');
        form.append('signature_version', '1');
        form.append('signature', signature);
        form.append('timestamp', timestamp);

        const acrUrl = `https://${process.env.ACR_HOST}${path}`;
        const r = await fetch(acrUrl, { method: 'POST', body: form, headers: form.getHeaders() });
        const j = await r.json();
        if(j.status && (j.status.code === 0 || j.status.code === '0') && j.metadata){
          const music = j.metadata.music && j.metadata.music[0];
          const result = {
            title: music.title,
            artist: music.artists && music.artists.map(a=>a.name).join(', '),
            album: music.album && music.album.name,
            raw: music
          };
          return res.json({ provider: 'ACRCloud', result });
        }
      } catch(e) {
        console.warn('ACRCloud attempt failed:', e && e.message);
      }
    }

    // AudD fallback
    if(process.env.AUDD_KEY){
      try {
        const form = new FormData();
        form.append('file', req.file.buffer, { filename: 'clip.webm' });
        form.append('api_token', process.env.AUDD_KEY);
        form.append('return', 'lyrics,spotify');
        const r = await fetch('https://api.audd.io/', { method: 'POST', body: form });
        const j = await r.json();
        if(j && j.status === 'success' && j.result){
          const r0 = Array.isArray(j.result) ? j.result[0] : j.result;
          return res.json({ provider: 'AudD', result: r0 });
        }
      } catch(e) {
        console.warn('AudD error', e && e.message);
      }
    }

    return res.json({ provider: null, result: null });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'identify_failed' });
  }
});

// Lyrics endpoint: try Musixmatch -> AudD
app.get('/lyrics', async (req, res) => {
  try {
    const { title, artist } = req.query;
    if(!title && !artist) return res.json({ provider: null, lyrics: null });

    if(process.env.MUSIXMATCH_KEY){
      try {
        const mmUrl = `https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?q_track=${encodeURIComponent(title||'')}&q_artist=${encodeURIComponent(artist||'')}&apikey=${process.env.MUSIXMATCH_KEY}`;
        const r = await fetch(mmUrl);
        const j = await r.json();
        const lyrics = j?.message?.body?.lyrics?.lyrics_body;
        if(lyrics) return res.json({ provider: 'Musixmatch', lyrics });
      } catch(e){ console.warn('Musixmatch error', e && e.message); }
    }

    if(process.env.AUDD_KEY){
      try {
        const q = encodeURIComponent(`${title} ${artist}`);
        const r = await fetch(`https://api.audd.io/findLyrics/?q=${q}&api_token=${process.env.AUDD_KEY}`);
        const j = await r.json();
        if(j.result && j.result.length) return res.json({ provider: 'AudD', lyrics: j.result[0].lyrics });
      } catch(e){ console.warn('AudD lyrics error', e && e.message); }
    }

    return res.json({ provider: null, lyrics: null });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'lyrics_failed' });
  }
});

app.listen(PORT, ()=> console.log('Proxy listening on', PORT));
