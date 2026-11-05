const P=[{t:'Přidej svítilnu k ruce SO-101',ru:'Добавь фонарик к руке SO-101',kind:'light'},
{t:'Add a flashlight to the SO-101 gripper',kind:'light'},
{t:'Udělej svítilnu silnější a zkontroluj kusovník',kind:'light2'}];
const STEPS=['Designer','CAD','Simulace','Kontrola BOM'];
export async function start(THREE,soP){
 const so=await soP;const c2=document.getElementById('c2');
 const r=new THREE.WebGLRenderer({canvas:c2,antialias:true,alpha:true,preserveDrawingBuffer:true});r.setPixelRatio(Math.min(devicePixelRatio,2));
 const s=new THREE.Scene();s.add(new THREE.HemisphereLight(0xffffff,0x223344,1.3));const d=new THREE.DirectionalLight(0xffffff,1.6);d.position.set(2,4,3);s.add(d);
 const cam=new THREE.PerspectiveCamera(32,1,.01,50);cam.position.set(0,.4,4.0);cam.lookAt(0,0,0);
 const sv=so.parts.map(p=>[p.o.position.clone(),p.o.rotation.z]);so.parts.forEach(p=>{p.o.position.copy(p.base);p.o.rotation.z=0});so.root.updateMatrixWorld(true);
 const arm=so.root.children[0].clone(true);so.parts.forEach((p,i)=>{p.o.position.copy(sv[i][0]);p.o.rotation.z=sv[i][1]});const g=new THREE.Group();g.add(arm);s.add(g);
 // gripper tip = farthest vertex from the base; direction = tip mesh centre -> tip
 g.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(arm);const base=new THREE.Vector3((bb.min.x+bb.max.x)/2,bb.min.y,(bb.min.z+bb.max.z)/2);
 const ms=[];arm.traverse(o=>{if(o.isMesh)ms.push(o)});base.copy(new THREE.Box3().setFromObject(ms[0]).getCenter(new THREE.Vector3()));const wrist=new THREE.Box3().setFromObject(ms[Math.max(0,ms.length-4)]).getCenter(new THREE.Vector3());
 let tip=new THREE.Vector3(),best=-1,tipMesh=null;const v=new THREE.Vector3();
 arm.traverse(o=>{if(!o.isMesh)return;const pa=o.geometry.attributes.position;for(let i=0;i<pa.count;i+=3){v.fromBufferAttribute(pa,i).applyMatrix4(o.matrixWorld);const dd=v.distanceTo(base);if(dd>best){best=dd;tip.copy(v);tipMesh=o;}}});
 const tc=new THREE.Box3().setFromObject(tipMesh).getCenter(new THREE.Vector3());
const fl=new THREE.Group();const body=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.32,24),new THREE.MeshStandardMaterial({color:0xff7a1a,metalness:.3,roughness:.4}));
 const lens=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.04,24),new THREE.MeshStandardMaterial({color:0xfff6c0,emissive:0xfff0a0,emissiveIntensity:0}));lens.position.y=.18;
 const cone=new THREE.Mesh(new THREE.ConeGeometry(.28,1.0,32,1,true),new THREE.MeshBasicMaterial({color:0xfff2a8,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
 cone.position.y=.2+.5;cone.rotation.x=Math.PI;fl.add(body,lens,cone);
 const dir=tip.clone().sub(wrist).normalize();fl.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
 fl.position.copy(tip).addScaledVector(dir,-.06);fl.scale.setScalar(0);g.add(fl);
 const pt=document.getElementById('pt'),stp=document.getElementById('steps');let A={fl:0,beam:0,boost:1};
 const FR=new URLSearchParams(location.search).has('freeze');const F=new URLSearchParams(location.search).has('fast')?0.1:1;const sleep=ms=>new Promise(r=>setTimeout(r,ms*F));
 const agEl=document.getElementById('ag');const vis=new Promise(res=>{const chk=()=>{const b=agEl.getBoundingClientRect();if(b.top<innerHeight*.6&&b.bottom>innerHeight*.4){removeEventListener('scroll',chk);res();}};addEventListener('scroll',chk,{passive:true});chk();});
 (async function loop(){if(FR){pt.textContent=P[0].t;stp.innerHTML=STEPS.map(x=>'<span class="st ok">✓ '+x+'</span>').join('');A.fl=1;A.beam=1;return;}await vis;for(let n=0;;n=(n+1)%P.length){const p=P[n];pt.textContent='';stp.innerHTML='';A.fl=0;A.beam=0;
  for(const ch of p.t){pt.textContent+=ch;await sleep(35);} if(p.ru){await sleep(300);pt.title=p.ru;}
  await sleep(400);const els=STEPS.map(x=>{const e=document.createElement('span');e.className='st';e.textContent=x;stp.append(e);return e;});
  for(let i=0;i<els.length;i++){els[i].className='st run';els[i].textContent='… '+STEPS[i];await sleep(700);els[i].className='st ok';els[i].textContent='✓ '+STEPS[i];
   if(i==1)A.fl=1; if(i==2)A.beam=1;}
  A.boost=p.kind=='light2'?1.8:1;await sleep(6000);}})();
 let cf=0,cb=0;const clock=new THREE.Clock();
 (function f(){requestAnimationFrame(f);const t=clock.getElapsedTime();const w=c2.clientWidth,h=c2.clientHeight;if(!w)return;
  r.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();
  cf+=(A.fl-cf)*.08;cb+=(A.beam-cb)*.06;fl.scale.setScalar(cf*.9);lens.material.emissiveIntensity=cb*2*A.boost;cone.material.opacity=cb*.22*A.boost*(.85+.15*Math.sin(t*6));
  g.rotation.y=Math.sin(t*.4)*.6+.4;g.position.y=Math.sin(t*1.5)*.02;r.render(s,cam);})();
 window.agentReady=true;window.AG={arm,A,stp,pt,base};}
