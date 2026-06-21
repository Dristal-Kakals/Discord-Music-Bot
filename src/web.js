import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import https from 'node:https';
import helmet from 'helmet';
import { Server } from 'socket.io';

export function startWebPanel({ player, playFromWeb, searchFromWeb, getVoiceChannels }) {
  const httpsPort = Number(process.env.WEB_HTTPS_PORT || 3443);
  const keyPath = process.env.WEB_SSL_KEY || '/opt/dsbot/certs/key.pem';
  const certPath = process.env.WEB_SSL_CERT || '/opt/dsbot/certs/cert.pem';
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '12kb' }));
  app.use('/api/', rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }));
  app.use('/api/play', rateLimit({
    windowMs: 10_000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get('/', (_request, response) => {
    response.type('html').send(renderPage());
  });

  app.get('/api/state', (_request, response) => {
    response.json(getState(player));
  });

  app.get('/api/voice-channels', (_request, response) => {
    response.json(getVoiceChannels());
  });

  app.get('/api/search', async (request, response) => {
    const query = String(request.query.q || '').trim();

    if (query.length < 2) {
      response.json([]);
      return;
    }

    if (query.length > 160) {
      response.status(400).json({ error: 'Query is too long' });
      return;
    }

    try {
      const tracks = await searchFromWeb(query);
      response.json(tracks.slice(0, 10).map((track) => ({
        title: track.title,
        author: track.author,
        duration: track.duration,
        query: track.url || (/^https?:\/\//i.test(query) ? query : `${track.author} - ${track.title}`),
        url: track.url,
      })));
    } catch (error) {
      console.error(error);
      response.status(500).json({ error: error.message || 'Search failed' });
    }
  });

  app.post('/api/play', async (request, response) => {
    const query = String(request.body.query || '').trim();

    if (!query) {
      response.status(400).json({ error: 'Missing query' });
      return;
    }

    if (query.length > 500 || (/^[a-z]+:/i.test(query) && !/^https?:\/\//i.test(query))) {
      response.status(400).json({ error: 'Invalid query' });
      return;
    }

    try {
      const voiceChannelId = String(request.body.voiceChannelId || '').trim();

      await playFromWeb(query, voiceChannelId || null);
      response.json({ ok: true });
    } catch (error) {
      console.error(error);
      response.status(500).json({ error: error.message || 'Play failed' });
    }
  });

  app.post('/api/:action', async (request, response) => {
    if (!['skip', 'stop', 'pause', 'resume'].includes(request.params.action)) {
      response.status(404).json({ error: 'Unknown action' });
      return;
    }

    const queue = getActiveQueue(player);

    if (!queue) {
      response.status(404).json({ error: 'Nothing is playing' });
      return;
    }

    try {
      if (request.params.action === 'skip') queue.node.skip();
      else if (request.params.action === 'stop') queue.delete();
      else if (request.params.action === 'pause') queue.node.pause();
      else if (request.params.action === 'resume') queue.node.resume();

      response.json({ ok: true });
    } catch (error) {
      console.error(error);
      response.status(500).json({ error: error.message || 'Action failed' });
    }
  });

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsServer = https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    }, app);
    const secureIo = new Server(httpsServer);

    secureIo.on('connection', (socket) => {
      socket.emit('state', getState(player));
    });

    setInterval(() => {
      secureIo.emit('state', getState(player));
    }, 1000);

    httpsServer.listen(httpsPort, '0.0.0.0', () => {
      console.log(`Web panel listening on https://0.0.0.0:${httpsPort}`);
    });
  } else {
    console.error(`Web panel SSL files missing: ${keyPath}, ${certPath}`);
  }
}

function getActiveQueue(player) {
  for (const queue of player) {
    if (queue.node.isPlaying() || queue.node.isPaused()) return queue;
  }

  return null;
}

function getState(player) {
  const queue = getActiveQueue(player);

  if (!queue) return { playing: false, paused: false, current: null, progress: null, queue: [] };

  const timestamp = queue.node.getTimestamp();
  const current = queue.currentTrack;

  return {
    playing: queue.node.isPlaying(),
    paused: queue.node.isPaused(),
    current: current ? {
      title: current.title,
      author: current.author,
      duration: current.duration,
      durationMS: current.durationMS,
      url: current.url,
    } : null,
    progress: timestamp ? {
      current: timestamp.current.label,
      total: timestamp.total.label,
      currentMS: timestamp.current.value,
      totalMS: timestamp.total.value,
    } : null,
    queue: queue.tracks.toArray().slice(0, 20).map((track) => ({
      title: track.title,
      author: track.author,
      duration: track.duration,
      url: track.url,
    })),
  };
}

function renderPage() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TeeMode Music</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}body{margin:0;min-height:100vh;background:radial-gradient(circle at top left,#45206b,#0c0f17 42%,#05060a);color:#f7f2ff}main{width:min(920px,calc(100% - 32px));margin:0 auto;padding:40px 0}.card{position:relative;background:rgba(18,20,31,.84);border:1px solid rgba(255,255,255,.09);border-radius:28px;padding:24px;box-shadow:0 24px 90px rgba(0,0,0,.45);backdrop-filter:blur(16px)}.player-card{z-index:20}.queue-card{z-index:1}h1{margin:0 0 18px;font-size:clamp(34px,7vw,72px);letter-spacing:-.07em}.track{display:grid;gap:8px;margin:18px 0}.title{font-size:clamp(22px,4vw,38px);font-weight:900;line-height:1.05}.author,.time,.muted{color:#b9aacb}.bar{height:14px;background:#222636;border-radius:999px;overflow:hidden;margin:18px 0 8px}.fill{height:100%;width:0%;background:linear-gradient(90deg,#8b5cf6,#22d3ee);border-radius:inherit;transition:width .25s linear}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.search{position:relative;z-index:50;flex:1 1 280px}input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.13);background:#090b12;color:white;border-radius:14px;padding:14px 16px;font-size:16px;outline:none}input:focus{border-color:#8b5cf6}.results{position:absolute;z-index:9999;top:54px;left:0;right:0;display:none;max-height:340px;overflow-y:auto;background:#090b12;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.45)}.result{padding:12px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06)}.result:hover{background:#191e2d}.result:last-child{border-bottom:0}.rtitle{font-weight:900}.rauthor{font-size:13px;color:#b9aacb}button{border:0;border-radius:14px;padding:14px 17px;background:#8b5cf6;color:white;font-weight:900;cursor:pointer}button.secondary{background:#242939}button.danger{background:#ef4444}button:hover{filter:brightness(1.08)}ol{padding-left:22px;color:#ded4ec}li{margin:10px 0}
</style></head><body><main><h1>TeeMode Music</h1><section class="card player-card"><div class="muted">Сейчас играет</div><div class="track"><div class="title" id="title">Ничего не играет</div><div class="author" id="author"></div></div><div class="bar"><div class="fill" id="fill"></div></div><div class="time" id="time">0:00 / 0:00</div><div class="row" style="margin-top:20px"><select id="voice" style="flex:1 1 220px;border:1px solid rgba(255,255,255,.13);background:#090b12;color:white;border-radius:14px;padding:14px 16px;font-size:16px;outline:none"><option>Загрузка войсов...</option></select><div class="search"><input id="query" name="tm_music_query" placeholder="Название трека или ссылка" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false"><div class="results" id="results"></div></div><button id="playButton">Play</button></div><div class="row" style="margin-top:14px"><button class="secondary" data-action="pause">Pause</button><button class="secondary" data-action="resume">Resume</button><button class="secondary" data-action="skip">Skip</button><button class="danger" data-action="stop">Stop</button></div></section><section class="card queue-card" style="margin-top:18px"><div class="muted">Очередь</div><ol id="queue"></ol></section></main><script>
const queryInput=document.getElementById('query');const resultsBox=document.getElementById('results');const voiceSelect=document.getElementById('voice');const playButton=document.getElementById('playButton');let selectedQuery='';let searchTimer=null;playButton.addEventListener('click',play);document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>action(button.dataset.action)));queryInput.addEventListener('input',()=>{selectedQuery='';clearTimeout(searchTimer);const q=queryInput.value.trim();if(!q||q.length<2||startsWithHttp(q)){resultsBox.style.display='none';return}searchTimer=setTimeout(()=>search(q),250)});queryInput.addEventListener('keydown',event=>{if(event.key==='Enter')play()});refreshState();refreshVoices();setInterval(refreshState,1000);setInterval(refreshVoices,10000);async function refreshState(){try{const res=await fetch('/api/state',{cache:'no-store'});if(res.ok)render(await res.json())}catch(error){console.error(error)}}async function refreshVoices(){try{const current=voiceSelect.value;const res=await fetch('/api/voice-channels',{cache:'no-store'});if(!res.ok)return;const channels=await res.json();voiceSelect.innerHTML=channels.map(c=>'<option value="'+escapeAttr(c.id)+'">'+escapeHtml(c.name)+' ('+c.members+')</option>').join('');if(current&&channels.some(c=>c.id===current))voiceSelect.value=current}catch(error){console.error(error)}}async function search(q){try{const res=await fetch('/api/search?q='+encodeURIComponent(q));if(!res.ok)return;const tracks=await res.json();resultsBox.innerHTML=tracks.map(t=>'<div class="result" data-query="'+escapeAttr(t.query)+'"><div class="rtitle">'+escapeHtml(t.title)+'</div><div class="rauthor">'+escapeHtml(t.author)+' · '+escapeHtml(t.duration)+'</div></div>').join('');resultsBox.style.display=tracks.length?'block':'none';document.querySelectorAll('.result').forEach(el=>el.addEventListener('click',()=>{selectedQuery=el.dataset.query;queryInput.value=selectedQuery;resultsBox.style.display='none';play()}))}catch(error){console.error(error)}}async function play(){const query=(selectedQuery||queryInput.value).trim();if(!query)return;resultsBox.style.display='none';playButton.disabled=true;try{const res=await fetch('/api/play',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,voiceChannelId:voiceSelect.value})});if(!res.ok)alert((await res.json()).error||'Ошибка')}finally{playButton.disabled=false}}async function action(name){const res=await fetch('/api/'+name,{method:'POST'});if(!res.ok)alert((await res.json()).error||'Ошибка')}function render(state){document.getElementById('title').textContent=state.current?.title||'Ничего не играет';document.getElementById('author').textContent=state.current?.author||'';document.getElementById('time').textContent=state.progress?state.progress.current+' / '+state.progress.total:'0:00 / 0:00';const pct=state.progress&&state.progress.totalMS?Math.min(100,state.progress.currentMS/state.progress.totalMS*100):0;document.getElementById('fill').style.width=pct+'%';document.getElementById('queue').innerHTML=state.queue.map(t=>'<li><b>'+escapeHtml(t.title)+'</b><br><span class="muted">'+escapeHtml(t.author)+' · '+escapeHtml(t.duration)+'</span></li>').join('')}function startsWithHttp(value){const lower=value.toLowerCase();return lower.startsWith('http://')||lower.startsWith('https://')}function escapeHtml(value){return String(value).replace(/[&<>\"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]))}function escapeAttr(value){return escapeHtml(value).replace(/'/g,'&#39;')}
</script></body></html>`;
}
