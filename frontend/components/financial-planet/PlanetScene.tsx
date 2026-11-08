"use client";
import {useEffect,useMemo,useRef} from 'react';
import {Canvas,useFrame} from '@react-three/fiber';
import {OrbitControls,ContactShadows} from '@react-three/drei';
import {BufferGeometry,Float32BufferAttribute,Color,Group,InstancedMesh,Object3D,Vector3,MeshStandardMaterial,DirectionalLight,MathUtils,DoubleSide,CanvasTexture,SRGBColorSpace,PointLight,AmbientLight,HemisphereLight} from 'three';
import type {PlanetState} from './planet-model';
const UP=new Vector3(0,1,0);
const FLOWERS=220;
const PETALS=24;
const flowerPalette=['#ff48a0','#f5d3e1','#a58ac9','#fff8fa','#eebed5','#ed248e','#bca3df','#ffffff'];
function surface(count:number){return Array.from({length:count},(_,index)=>{const y=1-2*(index+.5)/count;const angle=index*2.399963;const r=Math.sqrt(1-y*y);return new Vector3(Math.cos(angle)*r,y,Math.sin(angle)*r);});}
/** A curved, tapered petal rather than the previous sphere-shaped flower beads. */
function botanicalGeometry(leaf=false){
 const geometry=new BufferGeometry();const positions:number[]=[];const indices:number[]=[];const along=24;const across=16;
 for(let i=0;i<=along;i++){const u=i/along;for(let j=0;j<=across;j++){const v=j/across*2-1;const width=Math.pow(Math.sin(Math.PI*u),leaf?.85:.6)*(leaf?.24:.48);const curl=leaf?Math.sin(u*Math.PI)*.12:u*u*.55-Math.sin(u*Math.PI)*.15;positions.push(u,curl+v*v*Math.sin(Math.PI*u)*.15,v*width);}}
 for(let i=0;i<along;i++)for(let j=0;j<across;j++){const a=i*(across+1)+j;indices.push(a,a+across+1,a+1,a+1,a+across+1,a+across+2);}
 geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function BotanicalSurface({state,reduced}:{state:PlanetState;reduced:boolean}){
 const petals=useRef<InstancedMesh>(null);const centers=useRef<InstancedMesh>(null);const leaves=useRef<InstancedMesh>(null);
 const normals=useMemo(()=>surface(FLOWERS),[]);const leafNormals=useMemo(()=>surface(1100),[]);const petalGeometry=useMemo(()=>botanicalGeometry(),[]);const leafGeometry=useMemo(()=>botanicalGeometry(true),[]);
 const object=useMemo(()=>new Object3D(),[]);const color=useMemo(()=>new Color(),[]);const palette=useMemo(()=>flowerPalette.map(value=>new Color(value)),[]);const bloom=useRef(0);const strain=useRef(0);
 useFrame(({clock},delta)=>{
  if(!petals.current||!centers.current||!leaves.current)return;
  const target=state==='thriving'?1:0;
  bloom.current=reduced?target:MathUtils.damp(bloom.current,target,5,delta);strain.current=reduced?(state==='pressure'?1:0):MathUtils.damp(strain.current,state==='pressure'?1:0,5,delta);
  const wave=reduced?0:clock.elapsedTime*.25;
  normals.forEach((normal,index)=>{
   // Flower beds are exclusive to Thriving and shrink smoothly into the ground.
   const size=Math.max(.0001,bloom.current);
   const variation=.19+(index%7)*.013;const species=index%3;const origin=normal.clone().multiplyScalar(1.39+(.07+(index%4)*.028)*size);
   for(let petal=0;petal<PETALS;petal++){
    const ring=petal<12?0:petal<20?1:2;const count=ring===0?12:ring===1?8:4;const offset=ring===0?0:ring===1?12:20;const angle=(petal-offset)*Math.PI*2/(species===2?5:count)+index*.81+ring*.29;
    const visible=species===0|| (species===1?petal<12:petal<5);const scale=variation*(ring===0?1:ring===1?.72:.46)*size*(visible?1:.0001);
    object.position.copy(origin);object.quaternion.setFromUnitVectors(UP,normal);object.rotateY(angle+Math.sin(wave+index)*.018);object.translateY(ring*.027*size);object.translateX((ring===0?.018:ring===1?.012:.005)*size);object.rotateZ(ring===0?-.08:ring===1?.12:.35);object.scale.set(scale,scale*(species===1?.35:1),scale*(species===1?.48:species===2?1.25:1));object.updateMatrix();petals.current!.setMatrixAt(index*PETALS+petal,object.matrix);
    color.copy(palette[index%palette.length]).multiplyScalar(ring===0?1.04:ring===1?.94:.82);petals.current!.setColorAt(index*PETALS+petal,color);
   }
   object.position.copy(origin).addScaledVector(normal,.07*size);object.scale.setScalar((species===1?.045:species===2?.025:.012)*size);object.updateMatrix();centers.current!.setMatrixAt(index,object.matrix);
  });
  leafNormals.forEach((normal,index)=>{object.position.copy(normal).multiplyScalar(1.365+(index%4)*.013);object.quaternion.setFromUnitVectors(UP,normal);object.rotateY(index*1.71);object.rotateZ(-.2+Math.sin(wave+index)*.018);const scale=.15+(index%8)*.021;const foliage=Math.max(.0001,bloom.current);object.scale.set(scale*(1-strain.current*.3)*foliage,scale*foliage,scale*foliage);object.updateMatrix();leaves.current!.setMatrixAt(index,object.matrix);color.set(index%3===0?'#718f52':index%3===1?'#456447':'#8a9b60').lerp(new Color('#77786b'),strain.current*.88);leaves.current!.setColorAt(index,color);});
  for(const mesh of [petals.current,centers.current,leaves.current]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
 });
 return <><instancedMesh ref={leaves} args={[undefined,undefined,1100]} frustumCulled={false} castShadow receiveShadow><primitive object={leafGeometry} attach="geometry"/><meshStandardMaterial side={DoubleSide} roughness={.8}/></instancedMesh><instancedMesh ref={petals} args={[undefined,undefined,FLOWERS*PETALS]} frustumCulled={false} castShadow receiveShadow><primitive object={petalGeometry} attach="geometry"/><meshPhysicalMaterial side={DoubleSide} roughness={.57} metalness={0} sheen={.65} sheenColor="#fff3ea" clearcoat={.08}/></instancedMesh><instancedMesh ref={centers} args={[undefined,undefined,FLOWERS]} frustumCulled={false}><sphereGeometry args={[1,24,16]}/><meshStandardMaterial color="#bc9753" roughness={1}/></instancedMesh></>;
}
function Sprigs({state,reduced}:{state:PlanetState;reduced:boolean}){
 const group=useRef<Group>(null);const normals=useMemo(()=>surface(20),[]);const geometry=useMemo(()=>botanicalGeometry(true),[]);const object=useMemo(()=>new Object3D(),[]);const stems=useRef<InstancedMesh>(null);const leaves=useRef<InstancedMesh>(null);const material=useRef<MeshStandardMaterial>(null);const pressure=useRef(0);const target=useMemo(()=>new Color(),[]);
 useFrame((_,delta)=>{if(!stems.current||!leaves.current)return;pressure.current=reduced?(state==='pressure'?1:0):MathUtils.damp(pressure.current,state==='pressure'?1:0,5,delta);normals.forEach((normal,index)=>{const height=.24+(index%4)*.05;object.position.copy(normal).multiplyScalar(1.4+height/2);object.quaternion.setFromUnitVectors(UP,normal);object.rotateZ(pressure.current*.4);object.scale.set(.008,height,.008);object.updateMatrix();stems.current!.setMatrixAt(index,object.matrix);for(let leaf=0;leaf<8;leaf++){object.position.copy(normal).multiplyScalar(1.4+height*(leaf+1)/9);object.quaternion.setFromUnitVectors(UP,normal);object.rotateY(index+leaf*2.4);object.rotateZ(.3-pressure.current*.55);object.scale.setScalar(.11+(leaf%3)*.025);object.updateMatrix();leaves.current!.setMatrixAt(index*8+leaf,object.matrix);}});stems.current.instanceMatrix.needsUpdate=true;leaves.current.instanceMatrix.needsUpdate=true;if(material.current)material.current.color.lerp(target.set(state==='pressure'?'#777367':'#537f4b'),reduced?1:1-Math.exp(-5*delta));});
 return <group ref={group}><instancedMesh ref={stems} args={[undefined,undefined,20]} frustumCulled={false}><cylinderGeometry args={[1,1,1,6]}/><meshStandardMaterial color="#6f7753"/></instancedMesh><instancedMesh ref={leaves} args={[undefined,undefined,160]} frustumCulled={false} castShadow><primitive attach="geometry" object={geometry}/><meshStandardMaterial ref={material} color="#537f4b" side={DoubleSide} roughness={.8}/></instancedMesh></group>;
}
function terrainAt(x:number,y:number,z:number){
 return Math.sin(x*4.6+z*2.1)*.48+Math.cos(z*5.2-y*2.8)*.36+Math.sin(y*7+x*3)*.24+Math.sin(x*15+z*11)*.07;
}
function LandTrees({state,reduced}:{state:PlanetState;reduced:boolean}){
 const trunks=useRef<InstancedMesh>(null),crowns=useRef<InstancedMesh>(null),branches=useRef<InstancedMesh>(null);
 const stress=useRef(state==='pressure'?1:0);const visibility=useRef(state==='thriving'?0:1);
 const object=useMemo(()=>new Object3D(),[]),color=useMemo(()=>new Color(),[]),dry=useMemo(()=>new Color('#797469'),[]);
 const trees=useMemo(()=>surface(520).filter(n=>{const terrain=terrainAt(-n.x,n.y,n.z);return terrain>.35&&terrain<.65&&Math.abs(n.y)<.83;}),[]);
 useFrame((_,delta)=>{
  if(!trunks.current||!crowns.current||!branches.current)return;
  stress.current=reduced?(state==='pressure'?1:0):MathUtils.damp(stress.current,state==='pressure'?1:0,3,delta);
  visibility.current=reduced?(state==='thriving'?0:1):MathUtils.damp(visibility.current,state==='thriving'?0:1,3,delta);
  trees.forEach((normal,i)=>{
   const st=stress.current,height=.1+(i%5)*.014;const remaining=visibility.current*(1-st*(i%4===0?.15:.98));
   object.position.copy(normal).multiplyScalar(1.385+height*.45);object.quaternion.setFromUnitVectors(UP,normal);object.rotateZ(st*.25);object.scale.set(.01*remaining,height*remaining,.01*remaining);object.updateMatrix();trunks.current!.setMatrixAt(i,object.matrix);
   object.position.copy(normal).multiplyScalar(1.385+height);object.quaternion.setFromUnitVectors(UP,normal);object.rotateZ(st*.7);object.translateX(st*.045);object.scale.set(.055*remaining*(1-st*.35),height*.68*remaining*(1-st*.65),.055*remaining);object.updateMatrix();crowns.current!.setMatrixAt(i,object.matrix);
   color.set(i%3===0?'#668747':i%3===1?'#3f6c40':'#78934b').lerp(dry,st*.94);crowns.current!.setColorAt(i,color);
   for(let j=0;j<2;j++){object.position.copy(normal).multiplyScalar(1.385+height*.8);object.quaternion.setFromUnitVectors(UP,normal);object.rotateY(i*1.7+j*Math.PI);object.rotateZ(.75+st*.6);object.translateY(.023);object.scale.set(.005*remaining,.075*remaining,.005*remaining);object.updateMatrix();branches.current!.setMatrixAt(i*2+j,object.matrix);}
  });
  for(const mesh of [trunks.current,crowns.current,branches.current]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
 });
 return <group><instancedMesh ref={trunks} args={[undefined,undefined,trees.length]} frustumCulled={false} castShadow><cylinderGeometry args={[1,1,1,7]}/><meshStandardMaterial color="#776b59" roughness={1}/></instancedMesh><instancedMesh ref={branches} args={[undefined,undefined,trees.length*2]} frustumCulled={false}><cylinderGeometry args={[1,1,1,6]}/><meshStandardMaterial color="#766f62" roughness={1}/></instancedMesh><instancedMesh ref={crowns} args={[undefined,undefined,trees.length]} frustumCulled={false} castShadow><sphereGeometry args={[1,16,12]}/><meshStandardMaterial roughness={.95}/></instancedMesh></group>;
}
function planetTextures(gloomy:boolean){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
 const context=canvas.getContext('2d');if(!context)return null;
 const pixels=context.createImageData(canvas.width,canvas.height);const color=new Color();
 const ocean=new Color('#277fa3'),shore=new Color('#b0d7c9'),green=new Color('#56864c'),sand=new Color('#c5ba91');
 for(let v=0;v<512;v++)for(let u=0;u<1024;u++){
  const longitude=u/1024*Math.PI*2,latitude=v/512*Math.PI;
  const x=Math.cos(longitude)*Math.sin(latitude),y=Math.cos(latitude),z=Math.sin(longitude)*Math.sin(latitude);
  const terrain=terrainAt(x,y,z);
  const detail=(Math.sin(x*87+z*63)*Math.cos(y*79-z*43)+Math.sin(x*211+y*173+z*139)*.3)*.5;
  if(gloomy){
   const patch=Math.sin(x*8+z*5)*Math.cos(y*7-z*3)+.28*Math.sin(y*19+x*13);
   const dry=MathUtils.smoothstep(patch,-.25,.7);
   color.set('#79817a').lerp(new Color('#a99b86'),dry*.7);
   color.lerp(new Color('#a3a5a1'),MathUtils.smoothstep(terrain,.35,.8)*.65);
   const zone=Math.sin(x*5-z*3)*Math.cos(y*6+x*2)>.52;
   const seam=Math.abs(Math.sin(x*27+Math.sin(y*17)*.3)*Math.cos(z*23+y*19));
   if(zone&&seam<.035)color.multiplyScalar(.68);
   color.multiplyScalar(.94+detail*.1+patch*.055);
  }else{
   color.copy(ocean).lerp(shore,MathUtils.smoothstep(terrain,.05,.25));
   color.lerp(green,MathUtils.smoothstep(terrain,.19,.34));
   color.lerp(sand,MathUtils.smoothstep(terrain,.65,.95)*(.5+.5*Math.sin(y*12)));
   color.multiplyScalar(.96+detail*.11);
  }
  color.convertLinearToSRGB();const i=(v*1024+u)*4;pixels.data[i]=Math.min(255,color.r*255);pixels.data[i+1]=Math.min(255,color.g*255);pixels.data[i+2]=Math.min(255,color.b*255);pixels.data[i+3]=255;
 }
 context.putImageData(pixels,0,0);const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=8;return texture;
}
function EarthSurface({state,reduced}:{state:PlanetState;reduced:boolean}){
 const normal=useMemo(()=>planetTextures(false),[]);const gloomy=useMemo(()=>planetTextures(true),[]);
 const stressed=useRef<MeshStandardMaterial>(null);
 useEffect(()=>()=>{normal?.dispose();gloomy?.dispose();},[normal,gloomy]);
 useFrame((_,delta)=>{if(stressed.current)stressed.current.opacity=reduced?(state==='pressure'?1:0):MathUtils.damp(stressed.current.opacity,state==='pressure'?1:0,3,delta);});
 return <group><mesh castShadow receiveShadow><sphereGeometry args={[1.38,96,64]}/><meshStandardMaterial map={normal} bumpMap={normal} bumpScale={.018} roughness={.78}/></mesh><mesh receiveShadow><sphereGeometry args={[1.382,96,64]}/><meshStandardMaterial ref={stressed} map={gloomy} bumpMap={gloomy} bumpScale={.025} roughness={.97} transparent opacity={state==='pressure'?1:0} depthWrite={false}/></mesh></group>;
}
function GloomyWeather({reduced,state}:{reduced:boolean;state:PlanetState}){
 const rainMaterial=useRef<import('three').MeshBasicMaterial>(null);const weather=useRef(0);
 const rain=useRef<InstancedMesh>(null);const bolt=useRef<Group>(null);const flash=useRef<PointLight>(null);
 const object=useMemo(()=>new Object3D(),[]);
 const drops=useMemo(()=>Array.from({length:110},(_,i)=>({x:Math.sin(i*127.1)*2.05,z:Math.cos(i*73.7)*1.7,offset:(i*.618)%1,speed:1.3+(i%7)*.12})),[]);
 const segments=useMemo(()=>{
  const points=[new Vector3(1.55,2.1,0),new Vector3(1.25,1.65,0),new Vector3(1.52,1.7,0),new Vector3(1.02,.98,0)];
  return points.slice(1).map((end,i)=>{const start=points[i];const direction=end.clone().sub(start);return {position:start.clone().add(end).multiplyScalar(.5),length:direction.length(),quaternion:new Object3D().quaternion.setFromUnitVectors(UP,direction.normalize())};});
 },[]);
 useFrame(({clock},delta)=>{
  weather.current=reduced?0:MathUtils.damp(weather.current,state==='pressure'?1:0,3,delta);if(rainMaterial.current)rainMaterial.current.opacity=weather.current*.2;
  const time=clock.elapsedTime;
  if(rain.current){drops.forEach((drop,i)=>{object.position.set(drop.x,2.5-((time*drop.speed+drop.offset*5)%5),drop.z);object.rotation.set(0,0,-.13);object.scale.set(.003,.07+(i%3)*.02,.003);object.updateMatrix();rain.current!.setMatrixAt(i,object.matrix);});rain.current.instanceMatrix.needsUpdate=true;}
  // Two brief, low-intensity pulses per nine seconds; no flashing in reduced motion.
  const phase=time%9;const active=state==='pressure'&&!reduced&&((phase>6.2&&phase<6.29)||(phase>6.43&&phase<6.52));
  if(bolt.current)bolt.current.visible=active;if(flash.current)flash.current.intensity=active?2.2:0;
 });
 if(reduced)return null;
 return <group><instancedMesh ref={rain} args={[undefined,undefined,110]} frustumCulled={false}><cylinderGeometry args={[1,1,1,4]}/><meshBasicMaterial ref={rainMaterial} color="#899bb2" transparent opacity={0} depthWrite={false}/></instancedMesh><group ref={bolt} visible={false}>{segments.map((segment,i)=><mesh key={i} position={segment.position} quaternion={segment.quaternion}><cylinderGeometry args={[.012,.012,segment.length,6]}/><meshBasicMaterial color="#dee7f3" transparent opacity={.8}/></mesh>)}</group><pointLight ref={flash} position={[1.8,2.4,2]} color="#cedcf2" intensity={0} distance={8}/></group>;
}
function World({state,reduced,rotationStep}:{state:PlanetState;reduced:boolean;rotationStep:number}){
 const ambient=useRef<AmbientLight>(null),hemisphere=useRef<HemisphereLight>(null),fill=useRef<DirectionalLight>(null);const world=useRef<Group>(null);const ground=useRef<MeshStandardMaterial>(null);const sun=useRef<DirectionalLight>(null);const target=useMemo(()=>new Color(),[]);
 useFrame((_,delta)=>{const alpha=reduced?1:1-Math.exp(-5*delta);if(ambient.current)ambient.current.intensity=MathUtils.lerp(ambient.current.intensity,state==='pressure'?.42:.85,alpha);if(hemisphere.current){hemisphere.current.intensity=MathUtils.lerp(hemisphere.current.intensity,state==='pressure'?.55:1.3,alpha);hemisphere.current.color.lerp(target.set(state==='pressure'?'#b7c3ce':'#fff5eb'),alpha);}if(fill.current)fill.current.intensity=MathUtils.lerp(fill.current.intensity,state==='pressure'?.22:.8,alpha);if(world.current)world.current.rotation.y=reduced?rotationStep*Math.PI/6:MathUtils.damp(world.current.rotation.y,rotationStep*Math.PI/6,5,delta);if(ground.current)ground.current.color.lerp(target.set(state==='pressure'?'#85857e':state==='thriving'?'#4d6a50':state==='unknown'?'#9ca394':'#698759'),alpha);if(sun.current){sun.current.intensity=reduced?(state==='pressure'?1.2:3.2):MathUtils.damp(sun.current.intensity,state==='pressure'?1.2:3.2,4,delta);sun.current.color.lerp(target.set(state==='pressure'?'#bcc9dd':state==='thriving'?'#ffe4d1':'#f1f1e9'),alpha);}});
 return <><ambientLight ref={ambient} intensity={.85}/><hemisphereLight ref={hemisphere} args={[state==='pressure'?'#a9b7cb':'#fff5eb',state==='pressure'?'#262c36':'#6b7968',state==='pressure'?.4:1.3]}/><directionalLight ref={sun} position={[-3,5,5]} intensity={3.2} castShadow shadow-mapSize={[1024,1024]} shadow-bias={-.0005} shadow-normalBias={.03}/><directionalLight ref={fill} position={[4,1,2]} intensity={state==='pressure'?.13:.8} color="#d9dbea"/><group ref={world} rotation={[.16,0,-.1]}><EarthSurface state={state} reduced={reduced}/ ><BotanicalSurface state={state} reduced={reduced}/><LandTrees state={state} reduced={reduced}/>{state==='thriving'&&<Sprigs state={state} reduced={reduced}/>}</group><GloomyWeather state={state} reduced={reduced}/><ContactShadows position={[0,-1.96,0]} opacity={.16} scale={8} blur={3.5} far={4} resolution={128}/><OrbitControls enablePan={false} enableZoom={false} autoRotate={!reduced} autoRotateSpeed={.22} enableDamping={!reduced} dampingFactor={.08}/></>;
}
export default function PlanetScene({state,reduced,rotationStep,onUnavailable}:{state:PlanetState;reduced:boolean;rotationStep:number;onUnavailable:()=>void}){return <Canvas onCreated={({gl})=>{gl.domElement.addEventListener('webglcontextlost',onUnavailable,{once:true});}} shadows dpr={[1,2]} camera={{position:[0,.65,5.6],fov:42}} gl={{antialias:true,alpha:true,powerPreference:'low-power'}}><World state={state} reduced={reduced} rotationStep={rotationStep}/></Canvas>;}

