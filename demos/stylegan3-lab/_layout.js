// Visual layout check: populate each seam's canvases SYNCHRONOUSLY (inline API,
// bypassing the async queue which headless virtual-time can't pump) and snapshot.
const DIR = 'D:/projects/brovisionml/weights/stylegan3-r-ffhqu-256';
const g = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
const PSI = 0.7;
function showOnly(n){ ['sample','walk','mix','grid'].forEach(function(s){ $('#panel-'+s).style.display = s===n?'flex':'none'; }); }

const wa = g.generate({ seed: 1, truncation: PSI, returnLatents: true });
const wb = g.generate({ seed: 2, truncation: PSI, returnLatents: true });

// walk
drawBitmap($('#walk-a-canvas'), wa.image);
drawBitmap($('#walk-b-canvas'), wb.image);
drawBitmap($('#walk-mid'), g.synthesize(lerpW(wa.w, wb.w, 0.5)).image);
$('#walk-meta').textContent = 't = 0.50';
var row = $('#walk-strip'); row.textContent='';
for (var k=0;k<7;k++){ var t=k/6; var cv=document.createElement('canvas'); cv.className='strip-cell'; row.appendChild(cv); drawBitmap(cv, g.synthesize(lerpW(wa.w,wb.w,t)).image); }
showOnly('walk'); flush(); screenshot('_walk.png'); console.log('walk drawn');

// mix
drawBitmap($('#mix-a-canvas'), wa.image);
drawBitmap($('#mix-b-canvas'), wb.image);
drawBitmap($('#mix-result'), g.synthesize(mixW(wa.w, wb.w, 4, g.numWs, g.wDim)).image);
$('#mix-meta').textContent = 'coarse 0–3 from A · fine 4–15 from B';
showOnly('mix'); flush(); screenshot('_mix.png'); console.log('mix drawn');

// grid 3x3
var out=$('#grid-out'); out.style.gridTemplateColumns='repeat(3,1fr)'; out.textContent='';
for (var i=0;i<9;i++){ var c=document.createElement('canvas'); c.className='grid-cell'; out.appendChild(c); drawBitmap(c, g.generate({seed:i,truncation:PSI}).image); }
showOnly('grid'); flush(); screenshot('_grid.png'); console.log('grid drawn');
console.log('OK layouts');
