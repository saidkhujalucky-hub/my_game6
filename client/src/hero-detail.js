// Layered, fully original procedural superhero designs, optimized for a WebGL arena.
// Each hero has a bespoke helmet silhouette, armour, equipment and animated energy system.
export function decorateHero(rig, hero, index, {THREE, box, sphere, cyl, ring, mat, glowMat}) {
  const c=hero.color,a=hero.accent;
  const metal=mat(0x192a42,.83,.24), dark=mat(0x07121f,.72,.32),
    bright=mat(c,.72,.25), trim=mat(a,.78,.22),light=glowMat(a,.94);
  const moving=[];
  const part=(w,h,d,m,x,y,z,parent=rig)=>{const o=box(w,h,d,m,parent,x,y,z);o.castShadow=true;return o;};
  const crystal=(x,y,z,r=.3,color=light)=>sphere(r,color,rig,x,y,z,12);
  const blade=(x,y,z,height=.8,angle=0,material=trim)=>{
    const tip=cyl(0,.18,height,material,rig,x,y,z,6);tip.rotation.z=angle;tip.castShadow=true;return tip;
  };
  const halo=(radius,x,y,z,rotation=0,material=light)=>{
    const obj=new THREE.Mesh(new THREE.TorusGeometry(radius,.055,7,32),material);
    obj.position.set(x,y,z);obj.rotation.x=rotation;rig.add(obj);return obj;
  };
  // High-resolution segmented armour: chest exoskeleton, sternum, neck and abdominal plates.
  const breast=part(1.46,.79,.25,metal,0,3.59,.57);
  part(.68,.72,.14,bright,-.46,3.65,.74).rotation.z=-.18;
  part(.68,.72,.14,bright,.46,3.65,.74).rotation.z=.18;
  part(.65,.2,.17,trim,0,3.82,.83);
  for(let i=0;i<4;i++){
    const y=3.03-i*.22;
    part(1.28-i*.11,.12,.15,i%2?metal:trim,0,y,.61);
  }
  cyl(.4,.5,.38,metal,rig,0,4.49,0,10);
  // Power core with emissive annular rim and luminous inner crystal.
  const core=new THREE.Group();core.position.set(0,3.57,.78);rig.add(core);
  const frame=cyl(.4,.4,.09,trim,core,0,0,0,12);frame.rotation.x=Math.PI/2;
  const glow=cyl(.29,.29,.12,light,core,0,0,.12,12);glow.rotation.x=Math.PI/2;
  const inner=cyl(.13,.13,.14,metal,core,0,0,.21,8);inner.rotation.x=Math.PI/2;
  // Helmet cheek guards, central crest, glowing visors, vents and antenna sockets.
  const forehead=part(.96,.26,.27,metal,0,5.36,.48);
  part(.19,.48,.2,trim,0,5.61,.45);
  part(1.06,.11,.26,light,0,5.18,.75);
  for(const sign of [-1,1]){
    const s=sign;
    part(.18,.49,.51,metal,s*.59,4.99,.36);
    part(.17,.32,.16,trim,s*.55,5.05,.69);
    const ear=cyl(.18,.23,.12,bright,rig,s*.67,5.13,.06,10);ear.rotation.z=Math.PI/2;
    part(.19,.22,.4,light,s*.67,5.12,.28);
    const shoulder=part(.9,.36,.99,metal,s*1.14,4.33,0);shoulder.rotation.z=s*.14;
    part(.55,.16,.8,trim,s*1.24,4.55,.03).rotation.z=s*.12;
    // Upper arm and calf external plating.
    part(.12,.3,.3,bright,s*1.50,3.31,.18);
    part(.26,.26,.23,light,s*1.48,3.04,.30);
    part(.26,.63,.58,bright,s*.49,1.37,.43);
    part(.64,.13,.9,trim,s*.46,.47,.62);
    part(.65,.18,.35,metal,s*.46,.26,.69);
    // Thruster housings on lower back, with internal glow.
    part(.39,.86,.48,metal,s*.61,2.88,-.61);
    part(.20,.53,.18,light,s*.61,2.83,-.93);
  }
  // Silhouette + technology signature per original hero.
  switch(index){
    case 0: // VOLT: lightning forks, coil pack, conductive wires.
      for(const s of [-1,1]){
        for(let i=0;i<3;i++){blade(s*(.33+i*.25),5.8+i*.13,-.1,.66,s*.2);}
        const coil=halo(.38,s*.95,3.20,-.8,Math.PI/2);moving.push({object:coil,speed:s*.65});
        part(.22,.8,.24,trim,s*1.24,3.72,-.47).rotation.z=s*.3;
      }
      moving.push({object:halo(.7,0,3.57,1.01,0),speed:1.9});break;
    case 1: // TITAN: siege armor, hydraulic pistons and massive plates.
      for(const s of [-1,1]){
        part(.80,.48,1.25,bright,s*1.4,4.33,-.15).rotation.z=s*.22;
        part(.31,1.18,.36,metal,s*1.65,3.15,-.23);
        cyl(.19,.19,1.06,trim,rig,s*1.63,3.13,-.01,8);
        blade(s*1.57,4.94,-.19,.59,s*.41);
        part(.65,.44,.67,metal,s*.49,1.20,.37);
      }
      part(.92,.36,.26,trim,0,3.57,.92);break;
    case 2: // SPECTRA: prism feathers, photon crown and aerial stabilizers.
      for(const s of [-1,1]){
        for(let i=0;i<5;i++){
          const wing=part(.23,1.15+i*.19,.13,i%2?light:bright,s*(1.08+i*.27),3.52+i*.16,-.74);
          wing.rotation.z=-s*(.2+i*.1);
        }
        blade(s*.38,6.00,-.05,.82,s*.35);
      }
      moving.push({object:halo(1.12,0,4.14,-.83,Math.PI/2),speed:.65});break;
    case 3: // CRYO: crystal pauldrons, snowflake crown and icy vents.
      for(const s of [-1,1]){
        for(let i=0;i<3;i++)blade(s*(.26+i*.27),5.81+i*.16,-.13,.65+i*.14,s*.13,trim);
        for(let i=0;i<4;i++)blade(s*(1.04+i*.22),4.67-i*.29,-.21,.43,s*.64);
      }
      moving.push({object:halo(.94,0,3.57,.9,.1),speed:-.35});break;
    case 4: // EMBER: heat radiator fins and twin jet flames.
      for(const s of [-1,1]){
        for(let i=0;i<4;i++){
          const fin=part(.24,.78+i*.12,.39, i%2?trim:bright,s*(.52+i*.19),3.44+i*.13,-.68);
          fin.rotation.z=-s*(.23+i*.16);
        }
        blade(s*.53,5.86,-.08,.88,s*.22);
        crystal(s*.57,2.43,-.95,.26,light);
      }
      moving.push({object:halo(.81,0,3.53,1,0),speed:.9});break;
    case 5: // PHANTOM: stealth hood, crescent daggers, phase halo.
      for(const s of [-1,1]){
        const hood=part(.31,.56,.71,dark,s*.57,5.45,-.05);hood.rotation.z=s*.31;
        blade(s*.63,5.75,.12,.94,s*.55,metal);
        blade(s*1.26,2.35,.76,1.05,s*.75);
        part(.33,.86,.13,light,s*.8,2.67,-.69).rotation.z=s*.35;
      }
      moving.push({object:halo(1.16,0,3.56,.1,Math.PI/2),speed:.4});break;
    case 6: // FLORA: branchlike antlers and living botanical armor.
      for(const s of [-1,1]){
        const antler=blade(s*.47,5.91,0,1.06,s*.43);
        for(let i=0;i<3;i++){
          const leaf=part(.36,.60,.09,i%2?trim:bright,s*(.96+i*.22),4.33-i*.5,-.12);
          leaf.rotation.z=s*(.5+i*.12);
        }
        crystal(s*1.23,4.17,-.19,.24);
      }
      moving.push({object:halo(.67,0,3.57,.93,0),speed:-.5});break;
    case 7: // STORM: aerial vanes and storm capacitors.
      for(const s of [-1,1]){
        for(let i=0;i<4;i++){
          const vane=part(.16,.28,1.65, i%2?light:bright,s*(1.13+i*.21),3.75+i*.14,-.82);
          vane.rotation.y=s*(.12+i*.18);
        }
        const cap=halo(.43,s*.77,4.28,-.88,Math.PI/2);moving.push({object:cap,speed:s*1.4});
        blade(s*.46,5.9,0,.78,s*.31);
      }
      break;
    case 8: // NOVA: solar orbitals and triple light crowns.
      for(let i=0;i<3;i++){
        const or=halo(1.4+i*.22,0,3.26,-.15,i*.5, i%2?trim:light);
        moving.push({object:or,speed:(i%2?-.5:.6)+i*.12});
      }
      for(const s of [-1,1]){blade(s*.43,5.90,0,.89,s*.23);crystal(s*1.08,4.35,-.35,.25);}
      break;
    case 9: // GUARDIAN: exosuit rails, shield generators and heavy antennas.
      for(const s of [-1,1]){
        part(.55,1.25,.50,metal,s*1.36,3.55,-.38);
        part(.50,.16,1.1,trim,s*1.37,3.7,-.61);
        part(.6,.57,1.16,bright,s*1.45,4.42,-.26);
        blade(s*.69,5.96,-.13,.72,s*.34);
        const shieldDisc=halo(.74,s*1.49,3.30,.44,Math.PI/2);moving.push({object:shieldDisc,speed:s*.4});
      }
      break;
    case 10: // COMET: speed fins, exhaust nozzles, elongated swept crest.
      for(const s of [-1,1]){
        for(let i=0;i<4;i++){
          const fin=part(.14,.23,1.18+i*.23, i%2?trim:bright,s*(.56+i*.18),3.68+i*.24,-.9);
          fin.rotation.y=s*.32;
        }
        blade(s*.44,5.91,-.25,1.15,s*.35);
        part(.32,.39,.63,light,s*.8,2.7,-1.06);
      }
      moving.push({object:halo(.63,0,3.56,1.00,0),speed:2.3});break;
    case 11: // PULSAR: gravity containment rings and floating dark matter cores.
      for(let i=0;i<3;i++){
        const or=halo(1.10+i*.30,0,3.35,-.20,Math.PI/2*(i%2),i===1?trim:light);
        moving.push({object:or,speed:i%2?-1.2:.75});
      }
      for(const s of [-1,1]){
        blade(s*.38,6.03,0,.93,s*.17);
        crystal(s*1.60,3.7,-.4,.31);
      }
      break;
  }
  // Soft emissive particles in a personal orbit; low count for mobile performance.
  const positions=new Float32Array(20*3);
  for(let i=0;i<20;i++){
    const ang=i*2.399963, r=1.3+(i%4)*.31;
    positions[i*3]=Math.cos(ang)*r;
    positions[i*3+1]=2.2+(i%10)*.42;
    positions[i*3+2]=Math.sin(ang)*r;
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const particles=new THREE.Points(geo,new THREE.PointsMaterial({color:a,size:.09,transparent:true,opacity:.58,depthWrite:false}));
  rig.add(particles);
  rig.userData.heroDetails={moving,particles,core};
  return rig.userData.heroDetails;
}
