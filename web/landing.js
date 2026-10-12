const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/* ---------- landing ---------- */
const mqItem = `<span class="c-lime">Upload PDF & Notes</span> <span class="c-slash">•</span> <span class="c-pink">Instant AI Practice</span> <span class="c-slash">•</span> <span class="c-cy">3 Guided Hints</span> <span class="c-slash">•</span> <span class="c-yellow">Spot Misconceptions Live</span> <span class="c-slash">•</span> <span class="c-purple">Real-Time Gap Radar</span> <span class="c-slash">•</span> &nbsp; `;
const mq = $('#mq'); if (mq) mq.innerHTML = mqItem.repeat(6);
const word=['stuck point','misconception','knowledge gap','blind spot'];let wi=0;
setInterval(()=>{const r=$('#rot');if(!r)return;r.style.opacity=0;r.style.transform='translateY(14px)';setTimeout(()=>{wi=(wi+1)%4;if(r){r.textContent=word[wi];r.style.opacity=1;r.style.transform='none'}},300)},2600);
const cv=$('#cv'),cx=cv?cv.getContext('2d'):null;let W,H,P=[],M={x:-999,y:-999};
function rs(){if(!cv)return;W=cv.width=innerWidth;H=cv.height=innerHeight}rs();if(cv)addEventListener('resize',rs);
if(cv){
  for(let i=0;i<70;i++)P.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.5,vy:(Math.random()-.5)*.5});
  addEventListener('mousemove',e=>{M.x=e.clientX;M.y=e.clientY;const dx=e.clientX/W-.5,dy=e.clientY/H-.5;const b1=$('.b1'),b2=$('.b2');if(b1)b1.style.transform=`translate(${-dx*70}px,${-dy*70}px)`;if(b2)b2.style.transform=`translate(${dx*90}px,${dy*60}px)`});
  (function loop(){if(!cx)return;cx.clearRect(0,0,W,H);P.forEach((p,i)=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;const dx=M.x-p.x,dy=M.y-p.y,d=Math.hypot(dx,dy);if(d<160){p.x+=dx*.012;p.y+=dy*.012}
  cx.fillStyle='#b6ff3c';cx.globalAlpha=.7;cx.beginPath();cx.arc(p.x,p.y,1.8,0,7);cx.fill();for(let j=i+1;j<P.length;j++){const q=P[j],e=Math.hypot(p.x-q.x,p.y-q.y);if(e<120){cx.strokeStyle='#38e1ff';cx.globalAlpha=(1-e/120)*.35;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(q.x,q.y);cx.stroke()}}
  if(d<180){cx.strokeStyle='#ff4fd8';cx.globalAlpha=(1-d/180)*.6;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(M.x,M.y);cx.stroke()}});requestAnimationFrame(loop)})();
}
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.2});
const obs=()=>document.querySelectorAll('.rv').forEach(e=>io.observe(e));obs();
document.querySelectorAll('.tilt').forEach(c=>{c.onmousemove=e=>{const r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;c.style.transform=`perspective(700px) rotateY(${x*14}deg) rotateX(${-y*14}deg) translateY(-4px)`};c.onmouseleave=()=>c.style.transform=''});
const topBtn=$('#top');if(topBtn)topBtn.onclick=()=>scrollTo({top:0,behavior:'smooth'});
const LC=['Rule: D = b² − 4ac. Know it cold.','Strategy: read off a, b and c with their signs before touching anything.','Setup: a = 2, b = 3, c = −2, so compute 3² − 4(2)(−2).'];
function lad(i){document.querySelectorAll('#lad button').forEach(b=>b.classList.toggle('on',+b.dataset.i===i));const ldt=$('#ldt');if(ldt)ldt.textContent=LC[i]}
window.initLad = function() {
  document.querySelectorAll('#lad button').forEach(b=>{
    b.onclick=e=>{ e.preventDefault(); lad(+b.dataset.i); };
  });
  if($('#ldt')) lad(0);
};
window.initLad();


