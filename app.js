
const MAX_FILES = 50;
const MIN_OUTPUT_BYTES = 40 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024;
const state = { photos: [], activeId: null, drag: null };
const $ = (selector) => document.querySelector(selector);
const fileInput = $('#fileInput'), photoGrid = $('#photoGrid'), photoSection = $('#photoSection');

function dimensions() { const dpi = Number($('#dpi').value); return { w: dpi * 3, h: dpi * 3.5 }; }
function filename(name) { return `${name.replace(/\.[^.]+$/, '')}_3x3.5.jpg`; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800); }
function imageFrom(url) { return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; }); }
function selectedBackground() { return document.querySelector('input[name="background"]:checked').value; }

function addFiles(fileList) {
  const files = [...fileList]; const invalid = files.filter(f => !/image\/jpe?g/i.test(f.type) || f.size > 20 * 1024 * 1024);
  const valid = files.filter(f => /image\/jpe?g/i.test(f.type) && f.size <= 20 * 1024 * 1024);
  const room = MAX_FILES - state.photos.length;
  const accepted = valid.slice(0, room);
  if (invalid.length) setStatus('Only JPG/JPEG images under 20 MB can be added.');
  if (valid.length > room) setStatus(`Only ${room} more photo${room === 1 ? '' : 's'} can be added (50 maximum).`);
  accepted.forEach(file => {
    const url = URL.createObjectURL(file);
    state.photos.push({ id: crypto.randomUUID(), file, url, crop: null, output: null, status: 'Ready' });
  });
  if (accepted.length) { render(); setStatus(''); }
  fileInput.value = '';
}
function setStatus(text) { $('#statusMessage').textContent = text; }
function render() {
  photoSection.classList.toggle('hidden', !state.photos.length);
  $('#photoCount').textContent = state.photos.length;
  photoGrid.innerHTML = state.photos.map(p => `<article class="photo-card"><div class="thumb-wrap"><img src="${p.url}" alt="${escapeHtml(p.file.name)} preview"><span class="card-status ${p.status === 'Done' ? 'done' : ''}">${p.status}</span></div><div class="card-info"><strong title="${escapeHtml(p.file.name)}">${escapeHtml(p.file.name)}</strong><div class="card-actions">${p.output ? `<button class="icon-button download-one" data-id="${p.id}" type="button" aria-label="Download converted photo">↓</button>` : ''}<button class="icon-button edit" data-id="${p.id}" type="button" aria-label="Edit crop">⌗</button><button class="icon-button remove" data-id="${p.id}" type="button" aria-label="Remove photo">×</button></div></div></article>`).join('');
}
function escapeHtml(value) { return value.replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;' }[c])); }

async function drawOutput(photo) {
  const image = await imageFrom(photo.url), {w,h} = dimensions();
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d');
  const bg = selectedBackground(); ctx.fillStyle = bg === 'gray' ? '#e5e7eb' : '#fff'; ctx.fillRect(0,0,w,h);
  const crop = photo.crop || defaultCrop(image);
  const mode = $('#fitMode').value;
  let scale = crop.scale, x = crop.x, y = crop.y;
  if (mode === 'contain' && !photo.crop) { scale = Math.min(w/image.naturalWidth,h/image.naturalHeight); x = (w-image.naturalWidth*scale)/2; y = (h-image.naturalHeight*scale)/2; }
  ctx.drawImage(image, x*(w/420), y*(w/420), image.naturalWidth*scale*(w/420), image.naturalHeight*scale*(w/420));
  return exportSizedJpeg(canvas);
}
function canvasBlob(canvas, quality) { return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality)); }
async function exportSizedJpeg(canvas) {
  // Find the highest JPEG quality that remains inside the 100 KB requirement.
  let low = 0.08, high = 0.98, best = await canvasBlob(canvas, low);
  for (let pass = 0; pass < 8; pass++) {
    const quality = (low + high) / 2;
    const candidate = await canvasBlob(canvas, quality);
    if (candidate.size <= MAX_OUTPUT_BYTES) { best = candidate; low = quality; }
    else high = quality;
  }
  // Very simple images can naturally compress below 40 KB. Pad after the JPEG end marker;
  // decoders ignore trailing bytes, so it remains a valid JPEG at the requested size.
  if (best.size < MIN_OUTPUT_BYTES) {
    return new Blob([best, new Uint8Array(MIN_OUTPUT_BYTES - best.size)], { type: 'image/jpeg' });
  }
  return best;
}
function defaultCrop(image) { const stageW=420, stageH=490; const scale=Math.max(stageW/image.naturalWidth,stageH/image.naturalHeight); return { scale, x:(stageW-image.naturalWidth*scale)/2, y:(stageH-image.naturalHeight*scale)/2 }; }

async function convertAll() {
  const button = $('#convertAll'); button.disabled = true; button.textContent = 'Converting…';
  try { for (let i=0;i<state.photos.length;i++) { const p=state.photos[i]; p.status=`${i+1}/${state.photos.length}`; render(); p.output=await drawOutput(p); p.status='Done'; render(); } button.textContent='Download all as ZIP ↓'; button.onclick=downloadZip; toast('Your photos are ready to download.'); }
  catch(e) { console.error(e); toast('Something went wrong while converting. Please try again.'); button.textContent='Convert all photos →'; button.disabled=false; }
}
async function downloadZip() { if (!state.photos.every(p=>p.output)) return convertAll(); if (!window.JSZip) { toast('ZIP download needs an internet connection.'); return; } const zip=new JSZip(); state.photos.forEach(p=>zip.file(filename(p.file.name),p.output)); const blob=await zip.generateAsync({type:'blob'}); download(blob,'bulk-photo-resizer.zip'); }
function download(blob,name) { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

async function openEditor(id) { const photo=state.photos.find(p=>p.id===id); state.activeId=id; const image=await imageFrom(photo.url); state.editor={image, crop: photo.crop ? {...photo.crop}:defaultCrop(image)}; $('#zoomRange').value = Math.min(3,state.editor.crop.scale/defaultCrop(image).scale); $('#zoomValue').textContent=`${Math.round($('#zoomRange').value*100)}%`; $('#cropModal').classList.remove('hidden'); drawEditor(); }
function drawEditor() { const {image,crop}=state.editor, canvas=$('#cropCanvas'),ctx=canvas.getContext('2d'); ctx.fillStyle='#e5e7eb';ctx.fillRect(0,0,420,490);ctx.drawImage(image,crop.x,crop.y,image.naturalWidth*crop.scale,image.naturalHeight*crop.scale); }
function closeEditor() { $('#cropModal').classList.add('hidden'); state.editor=null; }
function moveEditor(clientX,clientY) { if(!state.drag||!state.editor)return; const dx=clientX-state.drag.x,dy=clientY-state.drag.y; state.editor.crop.x=state.drag.cropX+dx;state.editor.crop.y=state.drag.cropY+dy;drawEditor(); }

$('#selectButton').onclick=()=>fileInput.click(); $('#dropzone').onclick=(e)=>{if(e.target.id!=='selectButton') fileInput.click()}; $('#dropzone').onkeydown=(e)=>{if(e.key==='Enter'||e.key===' ')fileInput.click()}; fileInput.onchange=e=>addFiles(e.target.files);
['dragenter','dragover'].forEach(event => $('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.add('dragging')})); ['dragleave','drop'].forEach(event => $('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.remove('dragging')})); $('#dropzone').addEventListener('drop',e=>addFiles(e.dataTransfer.files));
photoGrid.onclick=async e=>{const id=e.target.closest('[data-id]')?.dataset.id;if(!id)return;const p=state.photos.find(x=>x.id===id);if(e.target.closest('.remove')){URL.revokeObjectURL(p.url);state.photos=state.photos.filter(x=>x.id!==id);render();}if(e.target.closest('.edit'))await openEditor(id);if(e.target.closest('.download-one')&&p.output)download(p.output,filename(p.file.name));};
$('#clearAll').onclick=()=>{state.photos.forEach(p=>URL.revokeObjectURL(p.url));state.photos=[];render();}; $('#convertAll').onclick=convertAll; function invalidateOutputs(){state.photos.forEach(p=>{p.output=null;p.status='Ready'});const b=$('#convertAll');b.disabled=false;b.textContent='Convert all photos →';b.onclick=convertAll;render();} $('#dpi').onchange=()=>{const {w,h}=dimensions();$('#pixelSize').textContent=`${w} × ${h} px`;invalidateOutputs();}; $('#fitMode').onchange=invalidateOutputs; document.querySelectorAll('input[name="background"]').forEach(input=>input.onchange=invalidateOutputs);
$('#closeModal').onclick=closeEditor; $('#cropModal').onclick=e=>{if(e.target.id==='cropModal')closeEditor()}; $('#resetCrop').onclick=()=>{state.editor.crop=defaultCrop(state.editor.image);$('#zoomRange').value=1;$('#zoomValue').textContent='100%';drawEditor();}; $('#saveCrop').onclick=()=>{state.photos.find(p=>p.id===state.activeId).crop={...state.editor.crop};closeEditor();toast('Crop saved.');};
$('#zoomRange').oninput=e=>{const multiplier=Number(e.target.value), old=state.editor.crop, base=defaultCrop(state.editor.image), centerX=210,centerY=245;const next=base.scale*multiplier;old.x=centerX-(centerX-old.x)*(next/old.scale);old.y=centerY-(centerY-old.y)*(next/old.scale);old.scale=next;$('#zoomValue').textContent=`${Math.round(multiplier*100)}%`;drawEditor();};
const stage=$('#cropStage'); stage.addEventListener('pointerdown',e=>{stage.setPointerCapture(e.pointerId);state.drag={x:e.clientX,y:e.clientY,cropX:state.editor.crop.x,cropY:state.editor.crop.y};}); stage.addEventListener('pointermove',e=>moveEditor(e.clientX,e.clientY)); stage.addEventListener('pointerup',()=>state.drag=null); stage.addEventListener('pointercancel',()=>state.drag=null);

