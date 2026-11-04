import * as THREE from 'three';
import { io } from 'socket.io-client';
import { createGameSocket } from './realtime.js';
import { decorateHero } from './hero-detail.js';
import { HEROES, MAX_PLAYERS, BASE_RADIUS, MAP_RADIUS, UPGRADE_COSTS, basePosition, clampToArena } from '../../shared/config.js';
import './style.css';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (x,a,b) => Math.min(b,Math.max(a,x));
const lerp = THREE.MathUtils.lerp;
const colorCSS = n => `#${n.toString(16).padStart(6,'0')}`;
const col = n => new THREE.Color(n);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1e34);
scene.fog = new THREE.FogExp2(0x0e2946, 0.0045);
const camera = new THREE.PerspectiveCamera(66,window.innerWidth/window.innerHeight,0.1,1100);
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
renderer.setSize(window.innerWidth,window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
$('game').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0x8fceff,0x143548,2.4));
const sun = new THREE.DirectionalLight(0xffd9ac,3.2);
sun.position.set(-90,175,-90);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-215;sun.shadow.camera.right=215;sun.shadow.camera.top=215;sun.shadow.camera.bottom=-215;
sun.shadow.camera.near=0.5;sun.shadow.camera.far=450;
sun.shadow.bias=-0.0003;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x63bdfc,0.85);fill.position.set(100,60,50);scene.add(fill);

const mats = {};
function mat(c,metalness=.15,roughness=.7){const key=`${c}-${metalness}-${roughness}`;return mats[key]??(mats[key]=new THREE.MeshStandardMaterial({color:c,metalness,roughness}));}
function glowMat(c,opacity=1){return new THREE.MeshBasicMaterial({color:c,transparent:opacity<1,opacity,depthWrite:opacity===1});}
function mesh(geo,material,parent=scene,x=0,y=0,z=0){const o=new THREE.Mesh(geo,material);o.position.set(x,y,z);parent.add(o);return o;}
function box(w,h,d,material,parent=scene,x=0,y=0,z=0){return mesh(new THREE.BoxGeometry(w,h,d),material,parent,x,y,z);}
function cyl(top,bottom,height,material,parent=scene,x=0,y=0,z=0,sides=24){return mesh(new THREE.CylinderGeometry(top,bottom,height,sides),material,parent,x,y,z);}
function sphere(radius,material,parent=scene,x=0,y=0,z=0,seg=14){return mesh(new THREE.SphereGeometry(radius,seg,10),material,parent,x,y,z);}
function ring(radius,tube,material,parent=scene,x=0,y=0,z=0){const o=mesh(new THREE.TorusGeometry(radius,tube,8,64),material,parent,x,y,z);o.rotation.x=Math.PI/2;return o;}
function rng(seed=1){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
const rand=rng(90712);
function labelSprite(label,color='#b6eeff',width=320,height=75){
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d');ctx.clearRect(0,0,width,height);
  ctx.font='900 31px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor=color;ctx.shadowBlur=8;ctx.fillStyle=color;ctx.fillText(label,width/2,height/2);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(width/48,height/48,1);return sprite;
}

// -----------------------------------------------------------------------------
// MAP: sea, island, 12 tycoon bases, detailed procedural city and animated props.
// -----------------------------------------------------------------------------
const env = {baseGroups:[],energyCores:[],rings:[],streetLamps:[],drones:[],obstacles:[]};
function createOcean(){
  const shader=new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0}},
    vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float uTime;varying vec2 vUv;
      void main(){vec2 q=vUv*102.0;float w=sin(q.x*1.31+uTime*.85)*sin(q.y*.87-uTime*.65);
      float w2=sin(q.x*.23+q.y*.51+uTime*.23);float foam=pow(max(0.,sin(q.x*.8-q.y*.46+uTime)*sin(q.y*.34+uTime*.8)),8.);
      vec3 a=vec3(.023,.155,.25);vec3 b=vec3(.06,.35,.46);vec3 c=mix(a,b,.43+.17*w+.12*w2);
      c+=vec3(.04,.12,.13)*foam*.42;gl_FragColor=vec4(c,1.);}`,
    side:THREE.DoubleSide
  });
  const o=mesh(new THREE.PlaneGeometry(1700,1700),shader,scene,0,-5.8,0);o.rotation.x=-Math.PI/2;env.water=shader;
  const cliff=mesh(new THREE.CylinderGeometry(198,208,12,128),mat(0x244a50,.13,.96),scene,0,-6,0);cliff.receiveShadow=true;
  const edge=cyl(196,199,2.6,mat(0x7da18a,.1,.8),scene,0,-1.3,0,128);edge.receiveShadow=true;
  const grass=cyl(194.8,196.2,.55,mat(0x375f5b,.1,.94),scene,0,0,0,128);grass.receiveShadow=true;
  ring(192,1.2,glowMat(0x64e5d5,.6),scene,0,.42,0);
  ring(199,1.5,mat(0x2f565b),scene,0,-3,0);
}
function createRoads(){
  const asphalt=mat(0x1d3447,.15,.94),sidewalk=mat(0x5d7787,.1,.93),mark=mat(0xb6c9c6,.04,.83);
  for(let i=-3;i<=3;i++){
    const d=i*33;
    const roadX=box(207,.12,12.5,asphalt,scene,d,.37,0);roadX.rotation.y=Math.PI/2;roadX.receiveShadow=true;
    const roadZ=box(207,.12,12.5,asphalt,scene,0,.39,d);roadZ.receiveShadow=true;
    for(let x=-96;x<=96;x+=9){
      if(x%33<11 && x%33>-11)continue;
      box(3.9,.02,.19,mark,scene,x,.48,d);
      box(.19,.02,3.9,mark,scene,d,.49,x);
    }
    box(207,.18,.7,sidewalk,scene,0,.46,d-7.2);
    box(207,.18,.7,sidewalk,scene,0,.46,d+7.2);
    box(.7,.18,207,sidewalk,scene,d-7.2,.46,0);
    box(.7,.18,207,sidewalk,scene,d+7.2,.46,0);
  }
  cyl(28,28,.35,mat(0x637f89,.3,.7),scene,0,.55,0,64);
  ring(26.5,.28,glowMat(0x51dff3,.8),scene,0,.75,0);
  for(let a=0;a<8;a++){
    const angle=a*TAU/8;
    const x=Math.cos(angle)*24,z=Math.sin(angle)*24;
    const pillar=cyl(1.05,1.2,3,mat(0x294b67,.4,.4),scene,x,2,z,8);
    cyl(1.26,1.26,.18,glowMat(0x5df8fc,.78),scene,x,3.6,z,8);
  }
}
function createBuildings(){
  const windowPoints=[];
  const groups=[0x263e59,0x24475a,0x3b4e66,0x2e546b,0x374b60,0x294356];
  const roofMat=mat(0x142b42,.55,.5),metal=mat(0x68879a,.65,.35);
  for(let ix=-3;ix<3;ix++)for(let iz=-3;iz<3;iz++){
    const cx=(ix+.5)*33,cz=(iz+.5)*33;
    if(Math.hypot(cx,cz)<38)continue;
    const bx=cx+(rand()-.5)*3.2,bz=cz+(rand()-.5)*3.2;
    const w=13+rand()*8.5,d=13+rand()*8.5,h=12+rand()*30+(rand()>.82?23:0);
    const m=mat(groups[Math.floor(rand()*groups.length)],.42,.55);
    const shell=box(w,h,d,m,scene,bx,h/2+.54,bz);shell.castShadow=true;shell.receiveShadow=true;
    env.obstacles.push({x:bx,z:bz,rx:w/2+1.45,rz:d/2+1.45});
    box(w+1,.6,d+1,roofMat,scene,bx,h+.8,bz);
    if(rand()>.44){
      box(w*.57,2,d*.55,m,scene,bx,h+2,bz);
      cyl(.75,.75,4,metal,scene,bx+(rand()-.5)*4,h+4,bz,8);
      sphere(.85,glowMat(0x78e7ec,.8),scene,bx+(rand()-.5)*2,h+6,bz);
    }
    const sx=Math.max(2,Math.floor(w/4)),sz=Math.max(2,Math.floor(d/4)),floors=Math.max(2,Math.floor(h/4));
    for(let row=0;row<floors;row++)for(let k=0;k<sx;k++){
      const yy=3.4+row*4,xx=bx-w/2+(k+.5)*w/sx;
      const lit=rand()>.34;
      if(lit){windowPoints.push({x:xx,y:yy,z:bz+d/2+.048,rot:0}, {x:xx,y:yy,z:bz-d/2-.048,rot:0});}
    }
    for(let row=0;row<floors;row++)for(let k=0;k<sz;k++){
      const yy=3.4+row*4,zz=bz-d/2+(k+.5)*d/sz;
      if(rand()>.3)windowPoints.push({x:bx+w/2+.048,y:yy,z:zz,rot:Math.PI/2},{x:bx-w/2-.048,y:yy,z:zz,rot:Math.PI/2});
    }
    if(rand()>.56){
      const awning=box(w*.63,.4,2,metal,scene,bx,3,bz+d/2+1);
      awning.castShadow=true;
    }
  }
  const windowGeometry=new THREE.PlaneGeometry(1.8,2.1);
  const instanced=new THREE.InstancedMesh(windowGeometry,new THREE.MeshBasicMaterial({color:0x9bd9d8,transparent:true,opacity:.75,side:THREE.DoubleSide}),windowPoints.length);
  const dummy=new THREE.Object3D();
  windowPoints.forEach((v,i)=>{
    dummy.position.set(v.x,v.y,v.z);dummy.rotation.set(0,v.rot,0);dummy.scale.set(1,1,1);dummy.updateMatrix();instanced.setMatrixAt(i,dummy.matrix);
  });
  instanced.instanceMatrix.needsUpdate=true;scene.add(instanced);
}
function createCentralTower(){
  env.obstacles.push({x:0,z:0,rx:15.5,rz:15.5});
  const g=new THREE.Group();scene.add(g);
  const steel=mat(0x284d67,.72,.28),light=glowMat(0x5ce4ff),accent=mat(0x75bcc7,.6,.3);
  cyl(14,16,9,steel,g,0,5,0,8);
  cyl(8,11,55,steel,g,0,36,0,8);
  for(let i=0;i<8;i++){
    const a=i*TAU/8;
    box(1.15,54,1.15,accent,g,Math.cos(a)*8,35,Math.sin(a)*8).rotation.y=-a;
    for(let j=0;j<10;j++){
      const zz=Math.sin(a)*8.9,xx=Math.cos(a)*8.9;
      const panel=box(1.9,1.75,.23,glowMat(j%3===0?0x81f0f4:0x3f8ac6,.74),g,xx,14+j*4.5,zz);
      panel.rotation.y=-a;
    }
  }
  cyl(12.5,8.4,8,steel,g,0,67.5,0,8);
  ring(12,.45,light,g,0,71.6,0);
  cyl(5,5,2,accent,g,0,74,0,8);
  cyl(.5,.65,8,accent,g,0,79,0,8);
  sphere(1.7,glowMat(0x4bebff),g,0,83.5,0);
  const floating=labelSprite('NEXUS TOWER','#83f1ff',360,62);floating.position.set(0,90,0);g.add(floating);
  env.centralOrb=sphere(3.3,new THREE.MeshBasicMaterial({color:0x63dcff,transparent:true,opacity:.54}),g,0,72,0);
  const beacon=new THREE.PointLight(0x67d8ff,30,65,2);beacon.position.set(0,73,0);g.add(beacon);
}
function createTrees(){
  const bark=mat(0x486056,.05,1),leaves=[mat(0x387c67),mat(0x44886d),mat(0x4d927b)];
  function tree(x,z,s){
    const trunk=cyl(.32*s,.48*s,3.8*s,bark,scene,x,2.1*s,z,7);trunk.castShadow=true;
    sphere(2.4*s,leaves[Math.floor(rand()*leaves.length)],scene,x,5.15*s,z,9).castShadow=true;
    sphere(1.8*s,leaves[Math.floor(rand()*leaves.length)],scene,x+1.05*s,4.45*s,z+.7*s,8);
  }
  for(let i=0;i<270;i++){
    const a=rand()*TAU,r=105+rand()*83,x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(Array.from({length:12},(_,k)=>basePosition(k)).some(b=>Math.hypot(x-b.x,z-b.z)<23))continue;
    tree(x,z,.6+rand()*.72);
  }
  for(let i=0;i<60;i++){
    const x=(rand()-.5)*188,z=(rand()-.5)*188;
    if(Math.abs(x%33)<12||Math.abs(z%33)<12||Math.hypot(x,z)<37)continue;
    if(Math.hypot(x,z)>98)continue;
    tree(x,z,.38+rand()*.28);
  }
}
function createStreetFurniture(){
  const pole=mat(0x607b8a,.58,.38),lamp=glowMat(0xd0f9ff,.9);
  for(let i=-3;i<=3;i++)for(let j=-3;j<=3;j++){
    const x=i*33+9,z=j*33+9;
    if(Math.hypot(x,z)>122)continue;
    cyl(.19,.24,8,pole,scene,x,4.5,z,7);
    box(2,.4,.45,pole,scene,x+1,8.3,z);
    box(1,.17,.3,lamp,scene,x+1.5,8.05,z);
    if(rand()>.55){
      const a=box(2.4,1.5,1.8,mat(0x2e4b67),scene,x-3,.8,z-3);a.castShadow=true;
      box(2.3,.15,1.7,glowMat(0x61afc8,.47),scene,x-3,1.66,z-3);
    }
  }
  for(let i=0;i<18;i++){
    const a=i*TAU/18,r=116+rand()*2,x=Math.cos(a)*r,z=Math.sin(a)*r;
    cyl(.4,.54,4.2,mat(0x234257,.4,.6),scene,x,2.2,z,7);
    sphere(.55,glowMat(0x70f4e6,.8),scene,x,4.8,z);
  }
}
function createBase(slot){
  const p=basePosition(slot),group=new THREE.Group();group.position.set(p.x,0,p.z);scene.add(group);
  const color=HEROES[slot].color;
  const baseMaterial=mat(0x233951,.42,.52),steel=mat(0x648197,.62,.42),glow=glowMat(color,.9);
  const foundation=cyl(20.5,22,1.15,baseMaterial,group,0,.65,0,12);foundation.castShadow=true;foundation.receiveShadow=true;
  cyl(17.4,17.4,.3,mat(0x34566d,.2,.7),group,0,1.34,0,12);
  ring(19.6,.37,glow,group,0,1.28,0);
  ring(14,.18,glowMat(color,.45),group,0,1.55,0);
  for(let j=0;j<12;j++){
    const a=j*TAU/12;
    const x=Math.cos(a)*18.7,z=Math.sin(a)*18.7;
    const bar=box(2.5,.18,1,glowMat(j%2===0?color:0xa5c4d1,.56),group,x,1.55,z);bar.rotation.y=-a;
  }
  const tower=cyl(4.8,6,8.2,baseMaterial,group,0,5.55,0,8);tower.castShadow=true;
  for(let j=0;j<8;j++){const a=j*TAU/8;box(.7,7,.7,steel,group,Math.cos(a)*5,5.3,Math.sin(a)*5);}
  cyl(5,4,1,steel,group,0,10.1,0,8);
  const reactor=sphere(2.1,glowMat(color,.85),group,0,12.5,0,16);
  const reactorRing=ring(3.2,.22,glow,group,0,12.5,0);reactorRing.rotation.x=0;
  const energy=sphere(4,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.08,depthWrite:false}),group,0,12.5,0,18);
  const label=labelSprite(`БАЗА ${slot+1}`,'#c6ecff',320,60);label.position.set(0,18.5,0);group.add(label);
  const extras=new THREE.Group();group.add(extras);
  env.obstacles.push({x:p.x,z:p.z,rx:6.6,rz:6.6});
  env.baseGroups.push({group,extras,slot,level:-1,color,p,reactor,reactorRing,energy});
  env.energyCores.push(reactor);
  return group;
}
function updateBaseVisual(base,level){
  if(base.level===level)return;
  base.level=level;
  base.extras.clear();
  const g=base.extras,c=base.color;
  if(level>=1){
    for(let i=0;i<4;i++){
      const a=i*TAU/4,px=Math.cos(a)*11,pz=Math.sin(a)*11;
      cyl(1.7,2.15,7,mat(0x426478,.48,.45),g,px,4.8,pz,8).castShadow=true;
      cyl(1.9,1.9,.5,glowMat(c,.75),g,px,8.5,pz,8);
      sphere(1.35,glowMat(c,.8),g,px,9.8,pz,10);
    }
  }
  if(level>=2){
    for(let i=0;i<2;i++){
      const a=i*Math.PI+.72,px=Math.cos(a)*14,pz=Math.sin(a)*14;
      const turret=new THREE.Group();turret.position.set(px,2.3,pz);g.add(turret);
      cyl(3.1,3.5,3.6,mat(0x4d647d,.6,.32),turret,0,1.9,0,8);
      sphere(2.3,glowMat(c,.65),turret,0,4.1,0);
      const barrel=box(1.35,1.4,5.2,mat(0x8cb8cf,.7,.26),turret,0,4.2,3.7);barrel.castShadow=true;
      box(1.4,.26,4.6,glowMat(c,.8),turret,0,4.96,3.7);
    }
  }
  if(level>=3){
    const dome=new THREE.Mesh(new THREE.SphereGeometry(21,28,16,0,TAU,0,Math.PI/2),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.08,side:THREE.DoubleSide,depthWrite:false}));
    dome.position.y=1.5;g.add(dome);
    ring(21,.37,glowMat(c,.5),g,0,1.8,0);
    for(let i=0;i<6;i++){
      const a=i*TAU/6;
      cyl(.65,.8,9,mat(0xb0a8e7,.63,.34),g,Math.cos(a)*16,5.4,Math.sin(a)*16,6);
    }
  }
}
function createParticlesSky(){
  const count=680,positions=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const r=260+rand()*240,a=rand()*TAU;
    positions[i*3]=Math.cos(a)*r;positions[i*3+1]=70+rand()*210;positions[i*3+2]=Math.sin(a)*r;
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));
  scene.add(new THREE.Points(g,new THREE.PointsMaterial({size:.85,color:0xcdeeff,transparent:true,opacity:.67,depthWrite:false})));
}
function createMap(){createOcean();createRoads();createBuildings();createCentralTower();createStreetFurniture();createTrees();for(let i=0;i<MAX_PLAYERS;i++)createBase(i);createParticlesSky();}
createMap();

// -----------------------------------------------------------------------------
// SUPERHERO MODELS: original stylized low-poly rigs, unique suits and weapons.
// -----------------------------------------------------------------------------
function createAvatar(heroIndex,name,target=scene){
  const hero=HEROES[heroIndex];
  const root=new THREE.Group(),rig=new THREE.Group();root.add(rig);target.add(root);
  const main=mat(hero.color,.48,.38),dark=mat(0x182a43,.48,.42),accent=mat(hero.accent,.65,.3);
  const visor=glowMat(hero.accent,.95);
  const torso=box(1.65,2.25,.95,main,rig,0,3.2,0);torso.castShadow=true;
  const chest=box(.94,.56,.1,accent,rig,0,3.55,.55);chest.castShadow=true;
  if(heroIndex===1||heroIndex===9){box(2.15,.45,1.1,accent,rig,0,4.26,0);}
  const head=sphere(.67,main,rig,0,5.11,0,12);head.castShadow=true;
  box(1,.21,.15,visor,rig,0,5.15,.62);
  const belt=box(1.6,.3,1.12,dark,rig,0,2.16,0);
  for(let side of [-1,1]){
    box(.22,.7,.22,accent,rig,side*.58,2.14,.55);
    const shoulder=sphere(.59,main,rig,side*1.17,4,0,10);shoulder.castShadow=true;
  }
  const leftArm=new THREE.Group(),rightArm=new THREE.Group();leftArm.position.set(-1.15,4.05,0);rightArm.position.set(1.15,4.05,0);rig.add(leftArm,rightArm);
  box(.65,1.7,.75,main,leftArm,0,-.95,0).castShadow=true;
  box(.65,1.7,.75,main,rightArm,0,-.95,0).castShadow=true;
  box(.7,.35,.8,accent,leftArm,0,-1.75,0);
  box(.7,.35,.8,accent,rightArm,0,-1.75,0);
  const leftLeg=new THREE.Group(),rightLeg=new THREE.Group();leftLeg.position.set(-.45,2.06,0);rightLeg.position.set(.45,2.06,0);rig.add(leftLeg,rightLeg);
  for(const leg of [leftLeg,rightLeg]){box(.7,1.82,.81,dark,leg,0,-.9,0).castShadow=true;box(.84,.42,1.3,main,leg,0,-1.76,.3);}
  // Character silhouette variations without copying licensed costume designs.
  if([2,5,8,11].includes(heroIndex)){
    const cape=new THREE.Mesh(new THREE.PlaneGeometry(2.1,3.2),new THREE.MeshStandardMaterial({color:hero.color,side:THREE.DoubleSide,transparent:true,opacity:.72,roughness:.85}));
    cape.position.set(0,2.65,-.65);cape.rotation.x=-.12;rig.add(cape);
  }
  if([0,7,10].includes(heroIndex)){
    const wing=new THREE.Group();rig.add(wing);
    for(let side of [-1,1]){
      const obj=box(.4,2.1,.25,accent,wing,side*.95,3.1,-.85);
      obj.rotation.z=-side*.45;
    }
  }
  if([3,4,6,9].includes(heroIndex)){
    for(let side of [-1,1]){
      const spike=cyl(0,.22,1,accent,rig,side*.48,5.85,-.07,5);spike.rotation.z=-side*.3;
    }
  }
  // Distinct character-specific hard-surface armor, helmet, effects and silhouette.
  decorateHero(rig,hero,heroIndex,{THREE,box,sphere,cyl,ring,mat,glowMat});
  // Held energy weapon.
  const weapon=new THREE.Group();rightArm.add(weapon);weapon.position.set(0,-1.2,.75);
  const barrel=box(.48,.46,1.95,dark,weapon,0,0,.75);barrel.castShadow=true;
  box(.38,.33,1.1,accent,weapon,0,.14,1.15);
  sphere(.22,visor,weapon,0,0,1.78,9);
  const pad=cyl(.8,.8,.06,new THREE.MeshBasicMaterial({color:hero.color,transparent:true,opacity:.25,depthWrite:false}),root,0,.17,0,16);
  const nameTag=labelSprite(name,'#eefbff',300,60);nameTag.position.set(0,7.35,0);root.add(nameTag);
  const healthBack=box(3.8,.28,.07,glowMat(0x172a3b,.9),root,0,6.55,0);
  const healthFront=box(3.72,.18,.085,glowMat(0x74f7a6,.9),root,0,6.55,.06);
  const shield=sphere(3.2,new THREE.MeshBasicMaterial({color:hero.accent,transparent:true,opacity:.15,wireframe:true,depthWrite:false}),root,0,3.4,0,18);
  shield.visible=false;
  return {root,rig,leftLeg,rightLeg,leftArm,rightArm,pad,nameTag,healthBack,healthFront,shield,heroIndex,lastHealth:-1};
}
function updateAvatarAppearance(obj,p,elapsed){
  obj.root.visible=!p.respawn;
  const moving=p.id===state.id?Math.hypot(state.inputX,state.inputZ)>0.15:Math.abs(obj.root.position.x-p.x)+Math.abs(obj.root.position.z-p.z)>.2;
  const bounce=moving?Math.sin(elapsed*12)*.10:Math.sin(elapsed*2.4)*.04;
  obj.rig.position.y=bounce;
  const walk=moving?Math.sin(elapsed*10)*.42:0;
  obj.leftLeg.rotation.x=walk;obj.rightLeg.rotation.x=-walk;
  obj.leftArm.rotation.x=-walk*.7;obj.rightArm.rotation.x=walk*.7-.2;
  obj.root.rotation.y=p.rot||0;
  const details=obj.rig.userData.heroDetails;
  if(details){
    for(const {object,speed} of details.moving)object.rotation.y=elapsed*speed;
    details.particles.rotation.y=elapsed*.3;
    details.core.scale.setScalar(1+Math.sin(elapsed*3.5)*.065);
  }
  obj.shield.visible=Boolean(p.shield);
  obj.healthFront.scale.x=Math.max(.003,p.hp/p.maxHp);
  obj.healthFront.position.x=-1.86+1.86*Math.max(.003,p.hp/p.maxHp);
  obj.nameTag.quaternion.copy(camera.quaternion);
  obj.healthBack.quaternion.copy(camera.quaternion);
  obj.healthFront.quaternion.copy(camera.quaternion);
}

function createDrone(n){
  const root=new THREE.Group();root.position.set(n.x,3.7,n.z);scene.add(root);
  const shell=mat(0x454c61,.66,.35),orange=glowMat(0xffb870,.94);
  const core=sphere(1.46,shell,root,0,0,0,12);core.castShadow=true;
  sphere(.68,orange,root,0,.12,1.16,12);
  const rotor=new THREE.Group();root.add(rotor);
  for(let j=0;j<4;j++){
    const a=j*TAU/4;
    const boom=box(.45,.26,2.2,shell,rotor,Math.cos(a)*1.2,.3,Math.sin(a)*1.2);
    boom.rotation.y=-a+Math.PI/2;
    const arm=sphere(.42,orange,rotor,Math.cos(a)*2.25,.3,Math.sin(a)*2.25,9);
  }
  const health=box(2.2,.13,.05,glowMat(0xffbb77,.95),root,0,2.6,0);
  const tag=labelSprite('ДРОН','#ffd6ad',260,55);tag.position.set(0,3.2,0);root.add(tag);
  return {root,rotor,health,seed:Math.random()*TAU};
}

// -----------------------------------------------------------------------------
// NETWORK AND WORLD STATE
// -----------------------------------------------------------------------------
// Render: оставь адрес пустым — клиент и Socket.IO работают на одном домене.
// GitHub Pages / Cloudflare Pages: задай VITE_SOCKET_URL с https-адресом Render.
// Для Direct Upload без сборки адрес задаётся в backend-config.js.
const backendURL = String(window.HERO_SOCKET_SERVER || import.meta.env?.VITE_SOCKET_URL || '').trim().replace(/\/$/, '');
const staticHost = /\.pages\.dev$|\.github\.io$|\.workers\.dev$/.test(window.location.hostname);
const cloudflareNative = staticHost && !backendURL;
const realtimeEndpoint = /\.github\.io$/.test(window.location.hostname)
  ? 'https://my-game6.saidkhujalucky.workers.dev/game-ws' : '/game-ws';
const socket=cloudflareNative
  ? createGameSocket(realtimeEndpoint)
  : io(backendURL || undefined, {autoConnect:true,reconnection:true,reconnectionAttempts:20,timeout:12000});
const state={active:false,id:null,room:null,hero:0,slot:null,players:new Map(),avatars:new Map(),npcs:new Map(),droneModels:new Map(),bullets:new Map(),effects:[],local:{x:0,z:0,rot:0},inputX:0,inputZ:0,fire:false,selected:0,camYaw:0,camPitch:.24,camDistance:20,cameraTime:0,lastMoveSend:0,lastFire:0,fxMuted:false,feedTimer:[],projectileFrames:0,localSpawnSync:false};
const keys=new Set();
let heroSelection=0,toastTimer;
const mobile=window.matchMedia('(pointer:coarse)').matches;
const selectedGlyphs=['ϟ','◆','✧','❄','✹','◈','❀','ϟ','✶','⬡','➤','✦'];
// Live turntable for inspecting each original character's unique 3D suit.
const showcaseScene=new THREE.Scene();
const showcaseCamera=new THREE.PerspectiveCamera(35,1,.1,100);
showcaseCamera.position.set(8.5,6.6,14.6);showcaseCamera.lookAt(0,3.2,0);
showcaseScene.add(new THREE.HemisphereLight(0x97dfff,0x263b56,3.0));
const keyLight=new THREE.DirectionalLight(0xffffff,3.1);keyLight.position.set(-6,10,10);showcaseScene.add(keyLight);
const rimLight=new THREE.DirectionalLight(0x69aaff,3);rimLight.position.set(6,5,-9);showcaseScene.add(rimLight);
const runway=new THREE.Mesh(new THREE.CylinderGeometry(2.35,2.65,.35,48),new THREE.MeshStandardMaterial({color:0x0b2337,metalness:.72,roughness:.25}));
runway.position.y=.03;showcaseScene.add(runway);
const runwayRing=new THREE.Mesh(new THREE.TorusGeometry(2.25,.045,6,70),new THREE.MeshBasicMaterial({color:0x7feeff}));
runwayRing.rotation.x=Math.PI/2;runwayRing.position.y=.26;showcaseScene.add(runwayRing);
let showcaseRenderer=null,showcaseActive=null;
const showcaseModels=new Map();
try{
  showcaseRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  showcaseRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  showcaseRenderer.setSize(350,320,false);
  showcaseRenderer.outputColorSpace=THREE.SRGBColorSpace;
  showcaseRenderer.toneMapping=THREE.ACESFilmicToneMapping;
  showcaseRenderer.toneMappingExposure=1.45;
  $('heroPreviewCanvas').appendChild(showcaseRenderer.domElement);
}catch(error){console.warn('Hero preview unavailable:',error);}
function refreshShowcase(index){
  const h=HEROES[index];
  $('showcaseName').textContent=h.name;
  $('showcaseClass').textContent=h.type.toUpperCase()+' · УНИКАЛЬНЫЙ КОСТЮМ';
  if(!showcaseRenderer)return;
  if(showcaseActive)showcaseActive.root.visible=false;
  let model=showcaseModels.get(index);
  if(!model){
    model=createAvatar(index,'',showcaseScene);
    model.nameTag.visible=false;model.healthBack.visible=false;model.healthFront.visible=false;
    model.root.position.y=.25;
    showcaseModels.set(index,model);
  }
  model.root.visible=true;showcaseActive=model;
  runwayRing.material.color.setHex(h.color);
}
function renderShowcase(dt,time){
  if(!showcaseRenderer||!showcaseActive||$('lobby').classList.contains('hidden'))return;
  const element=$('heroPreviewCanvas'),w=element.clientWidth,h=element.clientHeight;
  if(w<10||h<10)return;
  if(showcaseRenderer.domElement.width!==Math.round(w*showcaseRenderer.getPixelRatio()) || showcaseRenderer.domElement.height!==Math.round(h*showcaseRenderer.getPixelRatio())){
    showcaseRenderer.setSize(w,h,false);showcaseCamera.aspect=w/h;showcaseCamera.updateProjectionMatrix();
  }
  showcaseActive.root.rotation.y+=dt*.46;
  showcaseActive.rig.position.y=Math.sin(time*.0019)*.12;
  const d=showcaseActive.rig.userData.heroDetails;
  if(d){d.moving.forEach(({object,speed})=>object.rotation.y=time*.001*speed);d.particles.rotation.y=time*.0003;}
  runwayRing.rotation.z+=dt*.16;
  showcaseRenderer.render(showcaseScene,showcaseCamera);
}
function buildHeroGrid(){
  const grid=$('heroGrid');grid.innerHTML='';
  HEROES.forEach((hero,index)=>{
    const b=document.createElement('button');b.type='button';b.className='hero-tile'+(index===heroSelection?' active':'');
    b.style.setProperty('--hero',colorCSS(hero.color));
    b.innerHTML=`<span class="hero-checked">✓</span><div class="hero-glyph">${selectedGlyphs[index]}</div><div class="hero-name">${hero.name}</div><div class="hero-kind">${hero.type}</div>`;
    b.onclick=()=>selectHero(index);grid.appendChild(b);
  });
  updateHeroDetail();
}
function selectHero(index){heroSelection=index;[...$('heroGrid').children].forEach((el,i)=>el.classList.toggle('active',i===index));updateHeroDetail();}
function updateHeroDetail(){
  refreshShowcase(heroSelection);
  const h=HEROES[heroSelection];
  $('heroDetail').innerHTML=`<span class="detail-name" style="color:${colorCSS(h.color)}">${h.name}</span><span class="detail-item">⚔ <b>${h.weapon}</b></span><span class="detail-item">✧ <b>${h.ability}</b></span><span class="detail-item">♥ <b>${h.hp} HP</b></span><span class="detail-item">◉ <b>${h.speed.toFixed(1)} скорость</b></span>`;
}
buildHeroGrid();
$('nickname').value=localStorage.getItem('heroIslandsName')||'Игрок';
$('roomCode').value=localStorage.getItem('heroIslandsRoom')||'PUBLIC';
socket.on('connect',()=>{
  $('connectionDot').classList.add('online');$('connectionText').textContent='СЕРВЕР ОНЛАЙН';
  if(state.active){showToast('Соединение восстановлено. Нажми «Выход», чтобы войти заново.');}
});
socket.on('disconnect',()=>{
  $('connectionDot').classList.remove('online');$('connectionText').textContent='НЕТ СОЕДИНЕНИЯ';
  if(state.active)showToast('Потеряно соединение с сервером');
});
function join(){
  if(!socket.connected){$('lobbyMessage').textContent=cloudflareNative ? 'Игровой сервер Cloudflare пока не ответил. Перезагрузи страницу.' : 'Сервер игры не отвечает. Проверь, что backend запущен.';return;}
  $('playButton').disabled=true;$('lobbyMessage').textContent='Подключение к арене…';
  const nickname=$('nickname').value.trim().slice(0,18)||'Герой';
  const room=$('roomCode').value.trim().slice(0,14)||'PUBLIC';
  localStorage.setItem('heroIslandsName',nickname);
  localStorage.setItem('heroIslandsRoom',room.toUpperCase());
  socket.timeout(6000).emit('join',{hero:heroSelection,name:nickname,room},(err,res)=>{
    $('playButton').disabled=false;
    if(err||!res?.ok){$('lobbyMessage').textContent=res?.error||'Не удалось подключиться. Попробуй ещё раз.';return;}
    state.active=true;state.id=res.id;state.room=res.room;state.hero=res.hero;state.slot=res.slot;
    state.local.x=res.player.x;state.local.z=res.player.z;state.local.rot=res.player.rot;
    const home=basePosition(res.slot);state.camYaw=Math.atan2(-home.x,-home.z);
    state.localSpawnSync=true;
    $('lobby').classList.add('hidden');$('hud').classList.remove('hidden');
    $('roomLabel').textContent=res.room;
    const h=HEROES[res.hero];$('playerAvatar').textContent=selectedGlyphs[res.hero];
    $('playerAvatar').style.color=colorCSS(h.color);$('playerName').textContent=h.name;
    $('heroClass').textContent=h.type.toUpperCase();$('weaponName').textContent=h.weapon;
    $('abilityName').textContent=h.ability;
    if(res.hero!==heroSelection)showToast('Выбранный герой занят. Выдан свободный персонаж: '+h.name);
    if(!mobile){$('aimHint').classList.add('show');setTimeout(()=>$('aimHint').classList.remove('show'),4500);}
    updateHUD();
  });
}
$('playButton').addEventListener('click',join);
$('nickname').addEventListener('keydown',e=>{if(e.key==='Enter')join();});
function returnToMenu(){
  if(document.pointerLockElement)document.exitPointerLock();
  state.active=false;state.id=null;state.players.clear();state.npcs.clear();state.bullets.clear();state.localSpawnSync=false;
  socket.disconnect();socket.connect();
  for(const a of state.avatars.values())scene.remove(a.root);state.avatars.clear();
  for(const d of state.droneModels.values())scene.remove(d.root);state.droneModels.clear();
  for(const m of state.bullets.values())removeBullet(m);state.bullets.clear();
  $('hud').classList.add('hidden');$('lobby').classList.remove('hidden');$('lobbyMessage').textContent='';
}
$('menuButton').addEventListener('click',returnToMenu);
function showToast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);}
function addFeed(text){
  const div=document.createElement('div');div.className='event-item';div.textContent=text;
  $('feed').prepend(div);setTimeout(()=>div.remove(),5500);
  while($('feed').children.length>4)$('feed').lastChild.remove();
}
socket.on('feed',data=>{if(state.active)addFeed(data.text||'');});
socket.on('snapshot',packet=>{
  if(!state.active||packet.room!==state.room)return;
  const incoming=new Set();
  for(const p of packet.players){
    incoming.add(p.id);state.players.set(p.id,p);
    let avatar=state.avatars.get(p.id);
    if(!avatar){
      avatar=createAvatar(p.hero,p.name);avatar.root.position.set(p.x,.65,p.z);state.avatars.set(p.id,avatar);
    }
    if(p.id===state.id){
      const d=Math.hypot(state.local.x-p.x,state.local.z-p.z);
      if(d>8 || state.localSpawnSync || p.respawn || !Number.isFinite(state.local.x)){
        state.local.x=p.x;state.local.z=p.z;state.localSpawnSync=false;
      }else if(d>2.6){state.local.x=lerp(state.local.x,p.x,.1);state.local.z=lerp(state.local.z,p.z,.1);}
      p.x=state.local.x;p.z=state.local.z;p.rot=state.local.rot;
    }
    updateBaseVisual(env.baseGroups[p.slot],p.baseLevel);
  }
  for(const id of [...state.players.keys()]){
    if(!incoming.has(id)){
      state.players.delete(id);
      const avatar=state.avatars.get(id);if(avatar){scene.remove(avatar.root);state.avatars.delete(id);}
    }
  }
  const npcLive=new Set();
  for(const n of packet.npcs||[]){
    npcLive.add(n.id);state.npcs.set(n.id,n);
    if(!state.droneModels.has(n.id))state.droneModels.set(n.id,createDrone(n));
  }
  for(const id of [...state.npcs.keys()]){
    if(npcLive.has(id))continue;
    state.npcs.delete(id);
    const m=state.droneModels.get(id);if(m)scene.remove(m.root);
    state.droneModels.delete(id);
  }
  const live=new Set(packet.projectiles.map(b=>b.id));
  for(const b of packet.projectiles){
    let model=state.bullets.get(b.id);
    if(!model){
      model=new THREE.Group();
      const core=sphere(b.kind==='turret'?.72:.62,glowMat(b.color),model,0,0,0,12);
      const halo=sphere(b.kind==='turret'?1.4:1.22,new THREE.MeshBasicMaterial({color:b.color,transparent:true,opacity:.2,depthWrite:false}),model);
      model.position.set(b.x,2.9,b.z);scene.add(model);state.bullets.set(b.id,model);
    }
    model.userData.targetX=b.x;model.userData.targetZ=b.z;
  }
  for(const [id,model] of state.bullets){if(!live.has(id)){removeBullet(model);state.bullets.delete(id);}}
  updateHUD();
});
function removeBullet(group){
  group.traverse(obj=>{
    if(obj.isMesh){obj.geometry.dispose();obj.material.dispose();}
  });
  scene.remove(group);
}
function effectPulse(type,x,z,color,extra={}){
  const duration=type==='down'?1.45:type==='upgrade'?1.5:.7;
  const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false,side:THREE.DoubleSide});
  const object=ring(type==='down'?1.5:.9,.15,material,scene,x,.85,z);
  const flash=sphere(type==='impact'?.9:1.5,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.3,depthWrite:false}),scene,x,2,z,12);
  state.effects.push({object,flash,age:0,duration,type});
  if(type==='down'||type==='upgrade'||type==='nova'||type==='barrage')playSound(type);
}
socket.on('effect',e=>{
  if(!state.active)return;
  if(e.type==='muzzle')return;
  effectPulse(e.type,e.x||0,e.z||0,e.color||0x4ae8ff,e);
  if(e.playerId===state.id && ['dash','blink'].includes(e.type)){
    state.local.x=e.x;state.local.z=e.z;
  }
});
function playSound(type){
  if(state.fxMuted)return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    const ctx=state.sound||(state.sound=new AC());if(ctx.state==='suspended')ctx.resume();
    const oscillator=ctx.createOscillator(),gain=ctx.createGain();
    oscillator.type=type==='upgrade'?'sine':'sawtooth';
    oscillator.frequency.setValueAtTime(type==='upgrade'?480:190,ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(type==='upgrade'?920:60,ctx.currentTime+.22);
    gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.24);
    oscillator.connect(gain).connect(ctx.destination);oscillator.start();oscillator.stop(ctx.currentTime+.25);
  }catch{}
}

// -----------------------------------------------------------------------------
// GAME INPUT / CAMERA
// -----------------------------------------------------------------------------
function direction(){return {x:Math.sin(state.camYaw),z:Math.cos(state.camYaw)};}
function fire(){
  if(!state.active)return;
  const me=state.players.get(state.id);if(!me||me.respawn)return;
  const h=HEROES[state.hero],t=performance.now();
  if(t-state.lastFire<h.rate)return;
  state.lastFire=t;
  const d=direction();socket.emit('attack',{dx:d.x,dz:d.z});
  state.avatars.get(state.id)?.rightArm && (state.avatars.get(state.id).rightArm.rotation.x=-.9);
  playSound('fire');
}
function useAbility(){
  if(!state.active)return;
  const me=state.players.get(state.id);if(!me||me.respawn)return;
  if(me.skillReady>100){showToast(`Перезарядка: ${Math.ceil(me.skillReady/1000)} с`);return;}
  if(me.energy<HEROES[state.hero].skillCost){showToast('Недостаточно энергии');return;}
  const d=direction();socket.emit('ability',{dx:d.x,dz:d.z});
}
function upgrade(){
  if(!state.active)return;
  socket.emit('upgrade',{},res=>{
    if(!res?.ok){showToast(res?.error||'Невозможно улучшить базу');return;}
    showToast(`База улучшена! Уровень ${res.level}/3`);
    playSound('upgrade');
  });
}
window.addEventListener('keydown',e=>{
  if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','KeyE','KeyB','ArrowLeft','ArrowRight'].includes(e.code)&&state.active)e.preventDefault();
  if(e.repeat)return;
  keys.add(e.code);
  if(e.code==='KeyE')useAbility();
  if(e.code==='KeyB')upgrade();
  if(e.code==='KeyM')state.fxMuted=!state.fxMuted;
  if(e.code==='Escape'&&state.active){if(!document.pointerLockElement)showToast('ВЫХОД — кнопка справа вверху');}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();state.fire=false;});
renderer.domElement.addEventListener('click',()=>{
  if(state.active&&!mobile && !document.pointerLockElement)renderer.domElement.requestPointerLock?.();
});
renderer.domElement.addEventListener('mousedown',e=>{if(!state.active)return;if(e.button===0){state.fire=true;fire();}});
window.addEventListener('mouseup',e=>{if(e.button===0)state.fire=false;});
window.addEventListener('mousemove',e=>{
  if(document.pointerLockElement===renderer.domElement){state.camYaw-=e.movementX*.00235;state.camPitch=clamp(state.camPitch+e.movementY*.0016,-.18,.72);}
});
window.addEventListener('wheel',e=>{if(state.active)state.camDistance=clamp(state.camDistance+Math.sign(e.deltaY)*2,11,29);},{passive:true});
document.addEventListener('pointerlockchange',()=>{
  if(!state.active)return;
  $('aimHint').classList.toggle('show',!document.pointerLockElement&&!mobile);
});
$('upgradeButton').onclick=upgrade;
$('mobileSkill').onclick=useAbility;$('mobileBuild').onclick=upgrade;
const mobileFire=$('mobileFire');
mobileFire.addEventListener('pointerdown',e=>{e.preventDefault();state.fire=true;fire();});
for(const type of ['pointerup','pointercancel','pointerleave'])mobileFire.addEventListener(type,()=>state.fire=false);
for(const button of document.querySelectorAll('[data-key]')){
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>keys.delete(button.dataset.key));
}
let touchCamX=null;
renderer.domElement.addEventListener('touchstart',e=>{if(!state.active)return;const t=e.touches[0];if(t&&t.clientX>window.innerWidth*.4)touchCamX=t.clientX;},{passive:true});
renderer.domElement.addEventListener('touchmove',e=>{if(!state.active||touchCamX===null)return;const t=e.touches[0];if(!t)return;state.camYaw+=(touchCamX-t.clientX)*.008;touchCamX=t.clientX;},{passive:true});
renderer.domElement.addEventListener('touchend',()=>touchCamX=null,{passive:true});

function canWalk(x,z,fromX,fromZ){
  for(const b of env.obstacles){
    const ix=b.rx-Math.abs(x-b.x),iz=b.rz-Math.abs(z-b.z);
    if(ix<=0||iz<=0)continue;
    const oldX=b.rx-Math.abs(fromX-b.x),oldZ=b.rz-Math.abs(fromZ-b.z);
    // If a teleport placed us in a building, allow moving out rather than trapping the player.
    if(oldX>0 && oldZ>0 && Math.min(ix,iz)<Math.min(oldX,oldZ))continue;
    return false;
  }
  return true;
}
function groundLevel(x,z){
  for(const b of env.baseGroups)if(Math.hypot(x-b.p.x,z-b.p.z)<20.5)return 1.5;
  return .38;
}
function moveLocal(dt,t){
  const me=state.players.get(state.id);if(!me||me.respawn)return;
  const f=direction(),side={x:f.z,z:-f.x};
  let x=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
  let z=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0);
  const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}
  state.inputX=x;state.inputZ=z;
  let speed=HEROES[state.hero].speed;
  if(keys.has('ShiftLeft')||keys.has('ShiftRight'))speed*=1.32;
  if(me.boost)speed*=1.6;
  const dx=(side.x*x+f.x*z)*speed*dt,dz=(side.z*x+f.z*z)*speed*dt;
  const next=clampToArena(state.local.x+dx,state.local.z+dz);
  if(canWalk(next.x,state.local.z,state.local.x,state.local.z))state.local.x=next.x;
  if(canWalk(state.local.x,next.z,state.local.x,state.local.z))state.local.z=next.z;
  state.local.rot=state.camYaw;
  if(keys.has('ArrowLeft'))state.camYaw+=dt*1.7;
  if(keys.has('ArrowRight'))state.camYaw-=dt*1.7;
  if(t-state.lastMoveSend>57){
    socket.emit('move',{x:state.local.x,z:state.local.z,rot:state.local.rot});
    state.lastMoveSend=t;
  }
  if(state.fire)fire();
}

function updateHUD(){
  if(!state.active)return;
  const me=state.players.get(state.id);if(!me)return;
  $('playerCount').textContent=`${state.players.size} / 12`;
  $('healthFill').style.width=`${100*me.hp/me.maxHp}%`;
  $('energyFill').style.width=`${me.energy}%`;
  $('hpText').textContent=`${me.hp} / ${me.maxHp} HP`;
  $('energyText').textContent=`${me.energy} ENERGY`;
  $('coins').textContent=me.coins.toLocaleString('ru-RU');
  $('income').textContent=`+${14+11*me.baseLevel} / 4 с`;
  $('baseLevel').textContent=`УР. ${me.baseLevel} / 3`;
  $('buildProgress').style.width=`${me.baseLevel*100/3}%`;
  const upgrades=['Генератор','Защитные турели','Силовой купол'];
  const next=me.baseLevel>=3?'База полностью улучшена':`${upgrades[me.baseLevel]} — ${UPGRADE_COSTS[me.baseLevel]} кредитов`;
  $('nextUpgrade').textContent=next;
  $('upgradeButton').disabled=me.baseLevel===3||me.coins<UPGRADE_COSTS[me.baseLevel]||Boolean(me.respawn);
  const ready=me.skillReady<=0;
  $('cooldownText').textContent=ready?'ГОТОВО':`${(me.skillReady/1000).toFixed(1)}с`;
  $('skillCard').classList.toggle('cooling',!ready);
  $('respawn').classList.toggle('hidden',!me.respawn);
  if(me.respawn)$('respawnSeconds').textContent=String(Math.ceil(me.respawn/1000));
  const ranking=[...state.players.values()].sort((a,b)=>b.kills-a.kills||b.coins-a.coins).slice(0,6);
  const rows=$('leaderboardRows');rows.innerHTML='';
  ranking.forEach((p,i)=>{
    const row=document.createElement('div');row.className='leader-row'+(p.id===state.id?' self':'');
    const h=HEROES[p.hero];
    const rank=document.createElement('span');rank.textContent=String(i+1);
    const dot=document.createElement('i');dot.style.background=colorCSS(h.color);
    const label=document.createElement('b');label.textContent=p.name;
    const kills=document.createElement('em');kills.textContent=`${p.kills}⚔`;
    row.append(rank,dot,label,kills);rows.appendChild(row);
  });
}
function drawMinimap(){
  const canvas=$('minimap'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.save();ctx.translate(w/2,h/2);const scale=w/(MAP_RADIUS*2+14);
  ctx.beginPath();ctx.arc(0,0,MAP_RADIUS*scale,0,TAU);ctx.fillStyle='rgba(22,77,73,.96)';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#5fcac3';ctx.stroke();ctx.save();ctx.beginPath();ctx.arc(0,0,MAP_RADIUS*scale,0,TAU);ctx.clip();
  ctx.fillStyle='rgba(29,53,75,.8)';ctx.fillRect(-108*scale,-108*scale,216*scale,216*scale);
  ctx.strokeStyle='rgba(112,144,164,.38)';ctx.lineWidth=5*scale;
  for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(-107*scale,i*33*scale);ctx.lineTo(107*scale,i*33*scale);ctx.moveTo(i*33*scale,-107*scale);ctx.lineTo(i*33*scale,107*scale);ctx.stroke();}
  ctx.fillStyle='#94edff';ctx.beginPath();ctx.arc(0,0,5,0,TAU);ctx.fill();
  for(let i=0;i<12;i++){
    const p=basePosition(i),player=[...state.players.values()].find(v=>v.slot===i),c=colorCSS(HEROES[player?.hero??i].color);
    ctx.beginPath();ctx.arc(p.x*scale,p.z*scale,4,0,TAU);
    ctx.fillStyle=player?c:'rgba(133,185,204,.4)';ctx.fill();
    if(i===state.slot){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}
  }
  for(const npc of state.npcs.values()){if(npc.respawn)continue;ctx.beginPath();ctx.arc(npc.x*scale,npc.z*scale,2,0,TAU);ctx.fillStyle='#ffbd7b';ctx.fill();}
  for(const p of state.players.values()){
    ctx.beginPath();ctx.arc(p.x*scale,p.z*scale,p.id===state.id?4.1:2.8,0,TAU);
    ctx.fillStyle=p.id===state.id?'#fff':colorCSS(HEROES[p.hero].color);ctx.fill();
    if(p.id===state.id){ctx.beginPath();ctx.moveTo(p.x*scale,p.z*scale);ctx.lineTo((p.x+Math.sin(state.camYaw)*17)*scale,(p.z+Math.cos(state.camYaw)*17)*scale);ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();}
  }
  ctx.restore();ctx.restore();
}

// -----------------------------------------------------------------------------
// ANIMATION
// -----------------------------------------------------------------------------
const clock=new THREE.Clock();let elapsed=0,prevFrame=performance.now(),lastMap=0;
const cameraFocus=new THREE.Vector3(0,3,0);
function animate(time){
  requestAnimationFrame(animate);
  const dt=Math.min((time-prevFrame)/1000,.05);prevFrame=time;elapsed+=dt;
  env.water.uniforms.uTime.value=elapsed;
  env.centralOrb.scale.setScalar(1+Math.sin(elapsed*2)*.06);
  for(const b of env.baseGroups){
    b.reactor.position.y=12.5+Math.sin(elapsed*2+b.slot)*.38;
    b.reactorRing.rotation.z=elapsed*.65;
    b.energy.scale.setScalar(1+Math.sin(elapsed*1.8+b.slot)*.05);
  }
  if(state.active){
    moveLocal(dt,time);
    for(const [id,a] of state.avatars){
      const p=state.players.get(id);if(!p)continue;
      const x=id===state.id?state.local.x:p.x,z=id===state.id?state.local.z:p.z;
      const blend=id===state.id?1:clamp(dt*13,0,1);
      a.root.position.x=lerp(a.root.position.x,x,blend);
      a.root.position.z=lerp(a.root.position.z,z,blend);
      a.root.position.y=lerp(a.root.position.y,groundLevel(x,z),clamp(dt*11,0,1));
      updateAvatarAppearance(a,p,elapsed);
    }
    for(const [id,drone] of state.droneModels){
      const npc=state.npcs.get(id);if(!npc)continue;
      drone.root.visible=!npc.respawn;
      drone.root.position.x=lerp(drone.root.position.x,npc.x,clamp(dt*10,0,1));
      drone.root.position.z=lerp(drone.root.position.z,npc.z,clamp(dt*10,0,1));
      drone.root.position.y=3.8+Math.sin(elapsed*3+drone.seed)*.65;
      drone.root.rotation.y=npc.rot;
      drone.rotor.rotation.y+=dt*4.8;
      drone.health.scale.x=Math.max(.002,npc.hp/npc.maxHp);
      drone.health.position.x=-1.1+(npc.hp/npc.maxHp)*1.1;
      drone.health.quaternion.copy(camera.quaternion);
    }
    for(const b of state.bullets.values()){
      const a=clamp(dt*15,0,1);
      b.position.x=lerp(b.position.x,b.userData.targetX,a);
      b.position.z=lerp(b.position.z,b.userData.targetZ,a);
      b.children[0].rotation.y+=dt*8;
    }
    const me=state.players.get(state.id);
    if(me){
      const f=direction();
      const target=new THREE.Vector3(state.local.x,4.6,state.local.z);
      const height=8+Math.sin(state.camPitch)*state.camDistance*.74;
      const x=state.local.x-f.x*state.camDistance;
      const z=state.local.z-f.z*state.camDistance;
      const ideal=new THREE.Vector3(x,height,z);
      camera.position.lerp(ideal,clamp(dt*7,0,1));
      cameraFocus.lerp(target.clone().add(new THREE.Vector3(f.x*3.6,0,f.z*3.6)),clamp(dt*8,0,1));
      camera.lookAt(cameraFocus);
    }
    if(time-lastMap>150){drawMinimap();lastMap=time;}
  }else{
    const a=elapsed*.115;
    camera.position.set(Math.sin(a)*215,87+Math.sin(elapsed*.5)*8,Math.cos(a)*215);
    camera.lookAt(0,25,0);
  }
  for(let i=state.effects.length-1;i>=0;i--){
    const e=state.effects[i];e.age+=dt;
    const progress=e.age/e.duration;
    if(progress>=1){scene.remove(e.object,e.flash);e.object.geometry.dispose();e.flash.geometry.dispose();e.object.material.dispose();e.flash.material.dispose();state.effects.splice(i,1);continue;}
    const radius=e.type==='nova'?22:e.type==='upgrade'?27:e.type==='down'?12:8;
    e.object.scale.setScalar(1+progress*radius*.65);
    e.object.position.y=.8+progress*1.4;
    e.object.material.opacity=.8*(1-progress);
    e.flash.scale.setScalar(1+progress*5);
    e.flash.material.opacity=.24*(1-progress);
  }
  renderShowcase(dt,time);
  renderer.render(scene,camera);
}
requestAnimationFrame(animate);
window.addEventListener('resize',()=>{
  const w=window.innerWidth,h=window.innerHeight;
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,mobile?1.35:1.7));
});
