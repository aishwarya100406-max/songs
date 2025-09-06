// frontend/app.js
const fileInput = document.getElementById('fileInput');
const playlistEl = document.getElementById('playlist');
const audio = document.getElementById('audio');
const playPause = document.getElementById('playPause');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const seek = document.getElementById('seek');
const timeEl = document.getElementById('time');
const nowTitle = document.getElementById('nowTitle');
const nowArtist = document.getElementById('nowArtist');
const lyricsEl = document.getElementById('lyrics');
const lrcInput = document.getElementById('lrcInput');
const fetchLyricsBtn = document.getElementById('fetchLyrics');
const recordBtn = document.getElementById('recordBtn');
const proxyUrlInput = document.getElementById('proxyUrl');
const idResult = document.getElementById('idResult');

let tracks = JSON.parse(localStorage.getItem('tf_tracks')||'[]');
let favs = JSON.parse(localStorage.getItem('tf_favs')||'[]');
let current = 0;
let lrcLines = [];

function save(){ localStorage.setItem('tf_tracks', JSON.stringify(tracks)); localStorage.setItem('tf_favs', JSON.stringify(favs)); }
function escapeHtml(s){ return String(s||'').replace(/[&<>\"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":"&#39;"}[c])); }

function renderPlaylist(){
  playlistEl.innerHTML='';
  tracks.forEach((t,i)=>{
    const div = document.createElement('div'); div.className='track';
    div.innerHTML = `<div><strong>${escapeHtml(t.title||t.name||'Unknown')}</strong><div class="small">${escapeHtml(t.artist||'Local')}</div></div>
      <div><button onclick="playIndex(${i})">Play</button> <button onclick="removeTrack(${i})" style="background:#ef4444">Remove</button></div>`;
    playlistEl.appendChild(div);
  });
}

window.playIndex = function(i){ if(i<0||i>=tracks.length) return; current=i; audio.src = tracks[i].url; audio.play(); updateNow(); }

window.removeTrack = function(i){ tracks.splice(i,1); save(); renderPlaylist(); }

fileInput.addEventListener('change', e=>{
  for(const f of e.target.files){
    const url = URL.createObjectURL(f);
    tracks.push({name:f.name, title:f.name.replace(/\.[^/.]+$/,''), artist:'Local', url});
  }
  save(); renderPlaylist();
  fileInput.value='';
});

function updateNow(){
  const t = tracks[current]||{};
  nowTitle.textContent = t.title||'No track';
  nowArtist.textContent = t.artist||'—';
  playPause.textContent = audio.paused ? 'Play' : 'Pause';
}

playPause.addEventListener('click', ()=>{ if(!audio.src) return; if(audio.paused) audio.play(); else audio.pause(); playPause.textContent = audio.paused ? 'Play' : 'Pause'; });
audio.addEventListener('timeupdate', ()=>{
  if(isNaN(audio.duration)) return;
  seek.value = (audio.currentTime/audio.duration)*100;
  timeEl.textContent = formatTime(audio.currentTime)+' / '+formatTime(audio.duration);
  syncLyrics(audio.currentTime);
});
seek.addEventListener('input', ()=>{ if(!isNaN(audio.duration)) audio.currentTime = (seek.value/100)*audio.duration; });
function formatTime(s){ if(!s) return '0:00'; const m=Math.floor(s/60); const sec=Math.floor(s%60).toString().padStart(2,'0'); return m+':'+sec; }

lrcInput.addEventListener('change', async e=>{
  const f = e.target.files[0]; if(!f) return;
  const txt = await f.text(); lrcLines = parseLrc(txt); renderLyrics(); e.target.value='';
});

function parseLrc(text){
  const out = []; const lines = text.split(/\r?\n/);
  for(const ln of lines){
    const m = ln.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)/);
    if(m){
      const mm=parseInt(m[1],10), ss=parseInt(m[2],10), frac=m[3]?parseInt((m[3]+'00').slice(0,3),10):0;
      out.push({time: mm*60 + ss + frac/1000, text: m[4].trim()});
    }
  }
  out.sort((a,b)=>a.time-b.time); return out;
}

function renderLyrics(){
  lyricsEl.innerHTML=''; lrcLines.forEach((ln,i)=>{
    const d=document.createElement('div'); d.className='lyric-line'; d.dataset.index=i; d.dataset.time=ln.time; d.textContent=ln.text; lyricsEl.appendChild(d);
  });
}
function syncLyrics(t){
  if(!lrcLines.length) return;
  let idx=0;
  for(let i=0;i<lrcLines.length;i++){ if(t>=lrcLines[i].time) idx=i; else break; }
  lyricsEl.querySelectorAll('.lyric-line').forEach(n=>n.classList.remove('active'));
  const active = lyricsEl.querySelector(`.lyric-line[data-index="${idx}"]`);
  if(active){ active.classList.add('active'); active.scrollIntoView({behavior:'smooth', block:'center'}); }
}

fetchLyricsBtn.addEventListener('click', async ()=>{
  const t = tracks[current];
  if(!t) return alert('Play/select a track first');
  const base = proxyBase();
  try{
    const url = (base ? base.replace(/\/+$/,'') : '') + '/lyrics?title=' + encodeURIComponent(t.title) + '&artist=' + encodeURIComponent(t.artist||'');
    const res = await fetch(url);
    const j = await res.json();
    if(j?.lyrics){ // naive conversion: raw lyrics -> lines without timestamps
      lrcLines = j.lyrics.split('\n').filter(Boolean).map((ln,i)=>({time:i, text:ln}));
      renderLyrics(); alert('Loaded lyrics (no timestamps). Upload .lrc for perfect sync.');
    } else {
      alert('No lyrics found');
    }
  }catch(err){ console.error(err); alert('Lyrics fetch failed'); }
});

function proxyBase(){ const v = (proxyUrlInput.value||'').trim(); return v; }

// Identification: record ~3s and POST to /identify on proxy
recordBtn.addEventListener('click', async ()=>{
  idResult.textContent='Requesting mic...';
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e=> chunks.push(e.data);
    rec.onstop = async ()=>{
      const blob = new Blob(chunks, {type:'audio/webm'});
      idResult.textContent = 'Sending to identification...';
      const base = proxyBase();
      const url = (base ? base.replace(/\/+$/,'') : '') + '/identify';
      const fd = new FormData(); fd.append('audio', blob, 'clip.webm');
      try {
        const res = await fetch(url, { method:'POST', body: fd });
        const j = await res.json();
        if(j?.result){
          const r = j.result;
          idResult.innerHTML = `<strong>${escapeHtml(j.provider||'Provider')}</strong> → ${escapeHtml(r.title||r.song||r.name||'Unknown')} — ${escapeHtml(r.artist||r.performer||'')}`;
          if(confirm('Add this track to playlist?')){
            const urlCandidate = r.spotify?.external_urls?.spotify || r.song_link || r.url || '';
            tracks.push({title:r.title||r.song||r.name, artist:r.artist||r.performer||'', url: urlCandidate || ''});
            save(); renderPlaylist();
          }
          if(r.lyrics){
            lrcLines = (typeof r.lyrics === 'string' ? r.lyrics.split('\n').map((ln,i)=>({time:i, text:ln})) : []);
            renderLyrics();
          }
        } else {
          idResult.textContent = 'No match';
        }
      } catch(err) {
        console.error(err); idResult.textContent = 'Identification failed';
      }
    };
    rec.start();
    setTimeout(()=>rec.stop(), 3000);
  } catch(err){ console.error(err); idResult.textContent='Mic error'; }
});

// initial render
renderPlaylist();
if(tracks.length) { playIndex(0); audio.pause(); playPause.textContent='Play'; }
