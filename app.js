'use strict';
const STORE_KEY = 'playground_js_store_v6i';
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function debounce(fn, wait=600){
  let t, lastArgs;
  const deb = (...args)=>{ lastArgs=args; clearTimeout(t); t=setTimeout(()=>fn(...lastArgs), wait); };
  deb.flush = ()=>{ clearTimeout(t); if (lastArgs) fn(...lastArgs); };
  return deb;
}

let _uidCounter = 0;
function uid(){ _uidCounter += 1; return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}-${_uidCounter}`; }

function sampleExercise(title, desc){
  return { id: uid(), title, description: desc,
    html:`<!-- HTML -->
<div id="app">
  <h1>${title}</h1>
  <button id="go">Click</button>
</div>`,
    css:`/* CSS */
#app{font-family:sans-serif; padding:1rem}
button{padding:.4rem .8rem}`,
    js:`// JS
document.getElementById('go').addEventListener('click', ()=>console.log('Ciao Luca!'))`
  };
}

const defaultData = {
  categories:[
    { id: uid(), parentId: null, slug:'basi-js', title:'Basi di JavaScript', description:'Variabili, funzioni, operatori, eventi.', exercises:[
      sampleExercise('Somma semplice','Funzione somma e output su pagina.'),
    ]},
  ]
};

/* ------------------------------ BACKUP SU FILE ------------------------------ */
/*  File System Access API + IndexedDB
    - Memorizziamo SOLO l'handle in IndexedDB, non i dati.
    - Alla PRIMA selezione file: leggiamo e (se vuoi) importiamo. NON scriviamo mai.
    - Dopo modifiche: save() farà localStorage + (debounced) write su file. */

const IDB_NAME = 'playground_backup_handle_v1';
const IDB_STORE = 'kv';
const IDB_BACKUP_HANDLE_KEY = 'backupHandle';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const st = tx.objectStore(IDB_STORE);
    const rq = st.get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
    tx.oncomplete = () => db.close();
  }));
}
function idbSet(key, val) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    st.put(val, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const e = tx.error || new Error('IDB tx error'); db.close(); reject(e); };
  }));
}

function setFSStatus(msg) {
  const el = document.getElementById('fsStatus');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(setFSStatus._t);
  setFSStatus._t = setTimeout(()=>{ el.textContent = ''; }, 2000);
}
function setBackupName(name) {
  const el = document.getElementById('backupName');
  if (!el) return;
  el.textContent = name ? `📁 ${name}` : '(nessun backup)';
}
async function refreshBackupLabel() {
  const h = await getBackupFileHandle();
  setBackupName(h ? h.name : null);
}

async function setBackupFileHandle() {
  if (!window.showSaveFilePicker) throw new Error('File System Access API non supportata su questo browser');
  const handle = await window.showSaveFilePicker({
    suggestedName: 'playground-luca-backup.json',
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
  });
  await idbSet(IDB_BACKUP_HANDLE_KEY, handle);
  return handle;
}
async function getBackupFileHandle() {
  try {
    const h = await idbGet(IDB_BACKUP_HANDLE_KEY);
    if (!h) return null;
    const perm = await h.queryPermission?.({ mode: 'readwrite' });
    if (perm === 'granted') return h;
    const req = await h.requestPermission?.({ mode: 'readwrite' });
    return req === 'granted' ? h : null;
  } catch { return null; }
}
async function writeBackupFile(jsonText) {
  const handle = await getBackupFileHandle();
  if (!handle) return false;
  const w = await handle.createWritable();
  await w.write(jsonText);
  await w.close();
  return true;
}
// ✅ nuova: lettura dal file (per import iniziale)
async function readBackupFile(){
  const handle = await getBackupFileHandle();
  if (!handle) return null;
  try {
    const file = await handle.getFile();
    return await file.text();
  } catch (e) {
    console.error(e);
    return null;
  }
}

const writeBackupDebounced = debounce(async () => {
  try {
    const ok = await writeBackupFile(JSON.stringify(db));
    setFSStatus(ok ? '✅ Backup scritto' : 'ℹ️ Backup non impostato');
  } catch (e) {
    console.error(e);
    setFSStatus('⚠️ Errore backup');
  }
}, 400);

/* -------------------------------------------------------------------------- */

function load(){
  try{
    const d=JSON.parse(localStorage.getItem(STORE_KEY));
    if(d && Array.isArray(d.categories)) return d;
  }catch(e){}
  return defaultData;
}

// ⬇️ Salvataggio: localStorage + tentativo backup su file (debounced)
function save(){
  const text = JSON.stringify(db);
  localStorage.setItem(STORE_KEY, text);
  // prova backup su file se impostato
  writeBackupDebounced();
}

// Autosave (richiamato su ogni modifica a titolo/descrizione/codice)
const autoSaveDebounced = debounce(() => save(), 1200);

let db = load();
let currentCategoryId = null;

function getCategory(id){ return db.categories.find(c=>c.id===id) }
function getChildren(parentId){ return db.categories.filter(c => c.parentId === parentId) }
function getAncestors(cat){ const chain=[]; let cur=cat; while(cur && cur.parentId){ const p=getCategory(cur.parentId); if(!p) break; chain.unshift(p); cur=p; } return chain; }

function navigate(hash){ if(!hash || hash==='#/' || hash==='#home'){ showHome(); return; } const m=hash.match(/^#cat\/(.+)$/); if(m){ showCategory(m[1]); return; } showHome(); }
window.addEventListener('hashchange', ()=>navigate(location.hash));

function matchesQueryCategory(cat,q){ if(!q) return true; q=q.toLowerCase(); if((cat.title||'').toLowerCase().includes(q)) return true; if((cat.description||'').toLowerCase().includes(q)) return true;
  if((cat.exercises||[]).some(ex => (ex.title||'').toLowerCase().includes(q) || (ex.description||'').toLowerCase().includes(q))) return true;
  if(getChildren(cat.id).some(sc => matchesQueryCategory(sc,q))) return true; return false; }
function matchesQueryExercise(ex,q){ if(!q) return true; q=q.toLowerCase(); return (ex.title||'').toLowerCase().includes(q) || (ex.description||'').toLowerCase().includes(q); }

function showHome(){ setView('home'); const grid=$('#homeGrid'); grid.innerHTML=''; const q=$('#searchInput').value.trim();
  const top=db.categories.filter(c=>c.parentId==null); const cats=top.filter(c=>matchesQueryCategory(c,q)); $('#homeEmpty').style.display=cats.length?'none':'block';
  cats.forEach(cat=>grid.appendChild(catCard(cat))); refreshAllEditorsSoon(); }
function catCard(cat){ 
  const el=document.createElement('article'); 
  el.className='card'; 
  const subCount=getChildren(cat.id).length; 
  el.innerHTML=`
  <div class="thumb"></div>
  <div class="content">
    <h3>${escapeHTML(cat.title)}</h3>
    <p>${escapeHTML(cat.description||'')}</p>
    <div class="hr"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px">
      <span class="tag">${cat.exercises.length} esercizi${subCount?` · ${subCount} sottocat.`:''}</span>
      <div style="display:flex;gap:6px">
        <button class="btn" data-go="${cat.id}">Apri</button>
        <button class="btn" data-rename="${cat.id}">Rinomina</button>
        <button class="btn btn-danger" data-del="${cat.id}">Elimina</button>
      </div>
    </div>
  </div>`;

  // Apri
  el.querySelector('[data-go]').addEventListener('click', ()=>{ 
    const id=cat.id; 
    location.hash=`#cat/${id}`; 
    showCategory(id); 
  });

  // Rinomina
  el.querySelector('[data-rename]').addEventListener('click', ()=>{
    const c = getCategory(cat.id);
    if (!c) return;
    const newTitle = prompt('Nuovo nome categoria:', c.title);
    if (!newTitle) return;
    c.title = newTitle.trim();
    c.slug = slugify(c.title);
    save();
    if ($('#view-category').classList.contains('active') && currentCategoryId){
      showCategory(currentCategoryId);
    } else {
      showHome();
    }
  });

  // Elimina (nota: rimuove solo cat corrente e i figli di primo livello)
  el.querySelector('[data-del]').addEventListener('click', ()=>{
    if(!confirm(`Vuoi davvero eliminare la categoria "${cat.title}" e tutte le sue sottocategorie/esercizi?`)) return;
    db.categories = db.categories.filter(c => c.id !== cat.id && c.parentId !== cat.id);
    save();
    showHome();
  });

  return el; 
}

function showCategory(catId){ const cat=getCategory(catId); if(!cat){ location.hash='#home'; return; } currentCategoryId=catId; setView('category');
  $('#catTitle').textContent=cat.title; refreshCatMeta(cat);
  const bc=$('#breadcrumb'); if(bc){ bc.innerHTML=getAncestors(cat).map(a=>`<a href="#cat/${a.id}">${escapeHTML(a.title)}</a>`).join(' / '); }
  const subs=getChildren(cat.id), subGrid=$('#subCatsGrid'); if(subGrid){ subGrid.innerHTML=''; subs.forEach(sc=>subGrid.appendChild(catCard(sc))); $('#subCatsBlock').style.display=subs.length?'block':'none'; }
  renderExercises(cat); refreshAllEditorsSoon(); }

// ResizeObserver già pronto se ti serve osservare contenitori dinamici
const ro = new ResizeObserver(() => refreshAllEditorsSoon());
function observeResize(el){ if (!el) return; ro.observe(el); }

function refreshCatMeta(cat){ $('#catMeta').textContent = `${cat.exercises.length} esercizio/i · ${cat.description||''}`; }
function renderExercises(cat){ const q=$('#searchInput').value.trim(); const list=$('#exerciseList'); list.innerHTML=''; const items=(cat.exercises||[]).filter(ex=>matchesQueryExercise(ex,q));
  $('#catEmpty').style.display = items.length?'none':'block'; items.forEach((ex,i)=>list.appendChild(exerciseCard(cat.id,ex,i))); }

function makeEditor(textarea, mode){
  const cm=CodeMirror.fromTextArea(textarea,{
    mode,
    theme:'material',
    lineNumbers:true,
    tabSize:2,
    indentUnit:2,
    lineWrapping:true,
    autoCloseTags: true,
    autoCloseBrackets: true,
    extraKeys: { "Ctrl-Space": "autocomplete" }
  });
  cm.getWrapperElement().__cm = cm;
  if (CodeMirror.showHint){
    cm.on("inputRead", function(inst, change){
      if (!change || !change.text || change.text[0] === " ") return;
      const opts = { completeSingle:false };
      const m = mode;
      try{
        if (m === "javascript" && CodeMirror.hint && CodeMirror.hint.javascript) CodeMirror.showHint(inst, CodeMirror.hint.javascript, opts);
        else if (m === "css" && CodeMirror.hint && CodeMirror.hint.css) CodeMirror.showHint(inst, CodeMirror.hint.css, opts);
        else if (m === "htmlmixed" && CodeMirror.hint && CodeMirror.hint.xml) CodeMirror.showHint(inst, CodeMirror.hint.xml, opts);
      }catch(e){}
    });
  }
  return { getValue:()=>cm.getValue(), setValue:v=>cm.setValue(v||''), refresh:()=>cm.refresh(), onChange:fn=>cm.on('change',()=>fn(cm.getValue())), _raw:cm };
}

function exerciseCard(catId, ex, index){
  const wrap=document.createElement('article'); wrap.className='exercise';
  const htmlId=uid(), cssId=uid(), jsId=uid(), iframeId=uid();
  wrap.innerHTML=`
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="flex:1">
          <h4 contenteditable="true" data-bind="title">${escapeHTML(ex.title||'Senza titolo')}</h4>
          <div class="desc" contenteditable="true" data-bind="description">${escapeHTML(ex.description||'')}</div>
        </div>
        <div class="move-btns">
          <button class="btn" data-move="up" title="Sposta su">↑</button>
          <button class="btn" data-move="down" title="Sposta giù">↓</button>
        </div>
      </div>
      <div class="editors">
        <div class="editor"><div class="bar">HTML</div><textarea id="${htmlId}">${ex.html||''}</textarea></div>
        <div class="editor"><div class="bar">CSS</div><textarea id="${cssId}">${ex.css||''}</textarea></div>
        <div class="editor"><div class="bar">JS</div><textarea id="${jsId}">${ex.js||''}</textarea></div>
      </div>
      <div class="controls" style="flex-wrap:wrap;gap:10px">
        <button class="btn" data-run>Prova ▶</button>
        <button class="btn" data-window>Apri in finestra</button>
        <button class="btn" data-save>Salva</button>
        <button class="btn" data-delete>Elimina</button>
        <label style="display:flex;align-items:center;gap:6px;margin-left:auto">
          <input type="checkbox" data-auto checked> Aggiorna automatico
        </label>
      </div>
    </div>
    <div class="output">
      <div class="bar"><span>Anteprima</span><span class="muted">Console</span></div>
      <iframe id="${iframeId}" sandbox="allow-scripts allow-same-origin"></iframe>
      <div>  Console</div>
      <pre class="console" id="${iframeId}-console"></pre>
    </div>`;

  const $html=wrap.querySelector('#'+htmlId);
  const $css =wrap.querySelector('#'+cssId);
  const $js  =wrap.querySelector('#'+jsId);
  const $frame=wrap.querySelector('#'+iframeId);
  const $console = wrap.querySelector('#' + iframeId + '-console');

  const autoChk = wrap.querySelector('[data-auto]');
  const titleEl = wrap.querySelector('[data-bind="title"]');
  const descEl  = wrap.querySelector('[data-bind="description"]');

  const edHTML=makeEditor($html, 'htmlmixed');
  const edCSS =makeEditor($css, 'css');
  const edJS  =makeEditor($js, 'javascript');

  setTimeout(()=>{ edHTML.refresh(); edCSS.refresh(); edJS.refresh(); }, 0);

  function clearConsole(){ if ($console) $console.textContent = ''; }
  function appendConsole(level, parts){
    if (!$console) return;
    const line = document.createElement('div');
    const tag  = document.createElement('span');
    tag.className = 'muted';
    tag.textContent = '[' + (level || 'log').toUpperCase() + '] ';
    line.appendChild(tag);
    const msg = document.createElement('span');
    if (level === 'warn')  msg.className = 'warn';
    if (level === 'error') msg.className = 'error';
    msg.textContent = (parts || []).join(' ');
    line.appendChild(msg);
    $console.appendChild(line);
    $console.scrollTop = $console.scrollHeight;
  }

  // Ascolta i messaggi provenienti dall'iframe specifico di questa card
  const onMsg = (e)=>{
    if (e.source !== $frame.contentWindow) return;
    const d = e.data || {};
    if (!d.__pgLog) return;
    appendConsole(d.level || 'log', d.parts || []);
  };
  window.addEventListener('message', onMsg);

  // Aggiorna l'oggetto "ex" nel DB con i valori correnti dell'UI
  function updateRefFromUI(){
    const cat=getCategory(catId); if(!cat) return;
    const idx=cat.exercises.findIndex(e=>e.id===ex.id); if(idx===-1) return;
    const ref=cat.exercises[idx];
    ref.title = (titleEl?.textContent || '').trim() || 'Senza titolo';
    ref.description = (descEl?.textContent || '').trim();
    ref.html = edHTML.getValue();
    ref.css  = edCSS.getValue();
    ref.js   = edJS.getValue();
  }

  function runNow(){
    updateRefFromUI();
    clearConsole();
    const html=edHTML.getValue();
    const css =edCSS.getValue();
    const js  =edJS.getValue();
    try{ new Function(js); }catch(e){ appendConsole('error',[e.message||String(e)]); return; }
    runToIFrame($frame, html, css, js);
  }

  const scheduleRun = debounce(()=>{ if(autoChk?.checked) runNow(); }, 600);

  // Autosave su titoli/descrizioni
  titleEl?.addEventListener('input', ()=>{ updateRefFromUI(); autoSaveDebounced(); });
  descEl?.addEventListener('input',  ()=>{ updateRefFromUI(); autoSaveDebounced(); });

  // Autosave su editor + anteprima live
  edHTML.onChange(()=>{ updateRefFromUI(); scheduleRun(); autoSaveDebounced(); });
  edCSS .onChange(()=>{ updateRefFromUI(); scheduleRun(); autoSaveDebounced(); });
  edJS  .onChange(()=>{ updateRefFromUI(); scheduleRun(); autoSaveDebounced(); });

  wrap.querySelector('[data-run]').addEventListener('click', runNow);
  wrap.querySelector('[data-window]').addEventListener('click', ()=>{
    updateRefFromUI();
    const js = edJS.getValue(); try{ new Function(js); }catch(e){ appendConsole('error',[e.message||String(e)]); return; }
    openInWindow(edHTML.getValue(), edCSS.getValue(), js);
  });
  wrap.querySelector('[data-save]').addEventListener('click', ()=>{
    updateRefFromUI(); save(); runNow();
  });
  wrap.querySelector('[data-delete]').addEventListener('click', ()=>{
    if(!confirm('Eliminare questo esercizio?')) return;
    const cat=getCategory(catId); if(!cat) return;
    cat.exercises=cat.exercises.filter(e=>e.id!==ex.id); save();
    refreshCatMeta(cat); renderExercises(cat);
  });
  wrap.querySelector('[data-move="up"]').addEventListener('click', ()=>moveExercise(catId, ex.id, -1));
  wrap.querySelector('[data-move="down"]').addEventListener('click', ()=>moveExercise(catId, ex.id, +1));

  setTimeout(runNow, 0);
  return wrap;
}

function moveExercise(catId, exId, delta){
  const cat=getCategory(catId); if(!cat) return;
  const idx=cat.exercises.findIndex(e=>e.id===exId); if(idx===-1) return;
  const ni=idx+delta; if(ni<0 || ni>=cat.exercises.length) return;
  const [item]=cat.exercises.splice(idx,1); cat.exercises.splice(ni,0,item);
  save(); renderExercises(cat);
}

function buildHTMLDoc(html, css, js){
  const errBox = `
  <style>#__err{position:fixed;left:16px;right:16px;bottom:16px;background:#2b0f12;color:#ffd9de;border:1px solid #5a1b21;padding:10px 12px;border-radius:10px;font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;z-index:9999}</style>
  <script>(function(){function s(m,t){var b=document.getElementById('__err');if(!b){b=document.createElement('pre');b.id='__err';document.body.appendChild(b);}b.textContent=String(m)+(t?'\\n'+t:'');}window.addEventListener('error',function(e){s(e.message,e.error&&e.error.stack);});window.addEventListener('unhandledrejection',function(e){var r=e.reason||{};s(r.message||String(r),r.stack);});})();<\/script>`;
  const safeJS = `try{${js}}catch(e){if(window.__showError)window.__showError(e.message,e.stack);else console.error(e);}`;

  // Hook console.* → postMessage al parent (per la console sotto l’anteprima)
  const consoleHook = `
  <script>
  (function(){
    function toText(x){
      try{
        if (typeof x === 'string') return x;
        if (x === null || x === undefined) return String(x);
        if (x instanceof Error) return x.message;
        const s = JSON.stringify(x);
        return s === undefined ? String(x) : s;
      }catch(e){ return String(x); }
    }
    function send(level, args){
      try { parent && parent.postMessage({ __pgLog: true, level, parts: Array.from(args).map(toText) }, '*'); } catch(e){}
    }
    ['log','info','warn','error'].forEach(function(fn){
      const orig = console[fn];
      console[fn] = function(){
        send(fn, arguments);
        try{ orig && orig.apply(console, arguments); }catch(e){}
      };
    });
    window.addEventListener('error', function(e){
      send('error', [e.message || String(e.error || 'Error')]);
    });
    window.addEventListener('unhandledrejection', function(e){
      var r = e.reason;
      send('error', [ (r && (r.message || r.toString())) || 'Unhandled rejection' ]);
    });
  })();
  <\/script>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>
${html}
${errBox}
${consoleHook}
<script>${safeJS}<\/script>
</body></html>`;
}
function runToIFrame(iframe,html,css,js){
  const src=buildHTMLDoc(html,css,js);
  if('srcdoc' in iframe) iframe.srcdoc=src;
  else{ const doc=iframe.contentWindow.document; doc.open(); doc.write(src); doc.close(); }
}
function openInWindow(html,css,js){
  const src=buildHTMLDoc(html,css,js);
  const w=window.open('','_blank'); if(w){ w.document.open(); w.document.write(src); w.document.close(); }
}

$('#btnNewCat').addEventListener('click', ()=>{
  const title=prompt('Titolo categoria:'); if(!title) return;
  const description=prompt('Descrizione (opzionale):')||'';
  const cat={id:uid(), parentId:null, slug:slugify(title), title, description, exercises:[]};
  db.categories.push(cat); save(); showHome();
});
$('#btnNewSubCat')?.addEventListener('click', ()=>{
  if(!currentCategoryId) return; const parent=getCategory(currentCategoryId); if(!parent) return;
  const title=prompt('Titolo sottocategoria:'); if(!title) return;
  const description=prompt('Descrizione (opzionale):')||'';
  const sub={id:uid(), parentId:parent.id, slug:slugify(title), title, description, exercises:[]};
  db.categories.push(sub); save(); showCategory(parent.id);
});
$('#btnNewExercise').addEventListener('click', ()=>{
  if(!currentCategoryId) return; const cat=getCategory(currentCategoryId); if(!cat) return;
  const title=prompt('Titolo esercizio:')||'Nuovo esercizio';
  const description=prompt('Descrizione breve:')||'';
  cat.exercises.unshift({id:uid(), title, description, html:'', css:'', js:''});
  save(); refreshCatMeta(cat); renderExercises(cat);
});

$('#btnExportCat').addEventListener('click', ()=>{
  const cat=getCategory(currentCategoryId); if(!cat) return;
  const data=JSON.stringify(cat,null,2);
  download(`categoria-${cat.slug||cat.id}.json`,data);
});
$('#btnImportCat').addEventListener('click', async ()=>{
  const file=await pickFile('.json'); if(!file) return;
  try{
    const imported=JSON.parse(await file.text());
    imported.id=uid(); imported.parentId=currentCategoryId||null;
    imported.slug=imported.slug?imported.slug+'-import':'import-'+uid();
    imported.exercises=(imported.exercises||[]).map(e=>({id:e.id||uid(),...e}));
    db.categories.unshift(imported);
    save(); location.hash=`#cat/${imported.id}`; showCategory(imported.id);
  }catch(e){ alert('JSON non valido'); }
});

$('#btnHome').addEventListener('click', ()=>{ location.hash='#home'; showHome(); });
$('#searchInput').addEventListener('input', ()=>{
  if($('#view-category').classList.contains('active')){ const cat=getCategory(currentCategoryId); if(cat) showCategory(cat.id); }
  else showHome();
});

function setView(name){ $$('.view').forEach(v=>v.classList.remove('active')); const view=$('#view-'+name); view.classList.add('active'); refreshAllEditorsSoon(); }
function slugify(s){ return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function escapeHTML(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function download(filename,text){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:'application/json'})); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }
function pickFile(accept){ return new Promise(resolve=>{ const inp=document.createElement('input'); inp.type='file'; inp.accept=accept; inp.onchange=()=>resolve(inp.files[0]); inp.click(); }); }

let refreshTimer=null;
function refreshAllEditorsSoon(){ clearTimeout(refreshTimer); refreshTimer=setTimeout(()=>{ $$('.CodeMirror').forEach(w=>{ if(w.__cm){ try{ w.__cm.refresh(); }catch(e){} } }); }, 60); }
window.addEventListener('resize', refreshAllEditorsSoon);

// Navigazione iniziale
navigate(location.hash || '#home'); showHome(); refreshAllEditorsSoon();

/* --------------------------- Wiring pulsanti backup --------------------------- */
document.getElementById('btnSetBackup')?.addEventListener('click', async ()=>{
  try{
    const handle = await setBackupFileHandle();
    setFSStatus('📁 Backup impostato');
    await refreshBackupLabel();

    // 1) Prima LETTURA, mai scrittura al primo giro
    let importedText = null;
    try {
      const file = await handle.getFile();
      importedText = await file.text();
    } catch(e) { importedText = null; }

    // 2) Se il file contiene dati, proponi l'import (SOLO localStorage)
    if (importedText && importedText.trim()) {
      const wantsImport = confirm('Trovato un database nel file selezionato.\nVuoi IMPORTARLO sostituendo i dati locali attuali?');
      if (wantsImport) {
        try{
          const imported = JSON.parse(importedText);
          if (imported && Array.isArray(imported.categories)) {
            db = imported;
            localStorage.setItem(STORE_KEY, JSON.stringify(db)); // nessuna scrittura su file ora
            navigate('#home'); showHome();
            setFSStatus('✅ Dati importati dal backup');
          } else {
            alert('Il file selezionato non contiene un database valido.');
          }
        }catch(e){
          alert('Il file selezionato non è un JSON valido.');
        }
      }
    } else {
      setFSStatus('ℹ️ File vuoto: verrà scritto solo dopo le prossime modifiche/salvataggi');
    }
  }catch(e){
    console.error(e);
    alert('Impossibile impostare il file di backup.\nSuggerito: Chrome/Edge su desktop.');
  }
});

// All’avvio, mostra stato e prova (opzionale) import automatico se locale vuoto
(async ()=>{
  const h = await getBackupFileHandle();
  setFSStatus(h ? '📁 Backup pronto' : 'ℹ️ Backup non impostato');
  setBackupName(h ? h.name : null);

  if (h && !localStorage.getItem(STORE_KEY)) {
    try{
      const t = await (await h.getFile()).text();
      const imported = JSON.parse(t);
      if (imported && Array.isArray(imported.categories)) {
        db = imported;
        localStorage.setItem(STORE_KEY, JSON.stringify(db));
        navigate('#home'); showHome();
        setFSStatus('✅ Dati caricati dal backup (nessuna scrittura)');
      }
    }catch(e){ /* ignora */ }
  }
})();
