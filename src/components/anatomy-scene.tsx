'use client';
import { Component,Suspense,useEffect,useMemo,useRef,useState,type ReactNode } from 'react';
import { Canvas,useFrame,useThree } from '@react-three/fiber';
import { Html,OrbitControls,useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import manifest from '../../public/models/anatomy/manifest.json';
import { anatomyStructures,anatomyRegions } from '@/domain/anatomy-structures';
import { fitAnatomyDistance,layoutAnatomy } from '@/lib/anatomy-layout';
const MODEL_URL=`/models/anatomy/piper-child-6yo.glb?v=${manifest.meshSha256}`;
interface Props {
  explode:number; selected:string|null; region:string; isolate:boolean;
  view:{ direction:string;version:number;targetId?:string }; onSelect:(id:string|null) => void;onStatus:(status:'loading'|'ready'|'error') => void;
}
function ModelFailure({ onRetry }: {onRetry:() => void}) {
  return <div className="anatomy-loading" role="alert"><p>三维模型加载失败或图形上下文中断，请检查网络及浏览器 WebGL 支持。</p><button className="btn btn-secondary" onClick={onRetry}>重新加载</button></div>;
}
class ModelBoundary extends Component<{ children:ReactNode;onStatus:Props['onStatus'] },{ failed:boolean;attempt:number }> {
  state={ failed:false,attempt:0 };
  static getDerivedStateFromError() { return { failed:true }; }
  componentDidCatch() { this.props.onStatus('error'); }
  render() { return this.state.failed ? <ModelFailure onRetry={() => { this.props.onStatus('loading');useGLTF.clear(MODEL_URL);this.setState({ failed:false,attempt:this.state.attempt+1 }); }} /> : <div key={this.state.attempt} className="anatomy-three">{this.props.children}</div>; }
}
function Skeleton({ explode,selected,region,isolate,view,onSelect,onStatus }:Props) {
  const { scene }=useGLTF(MODEL_URL);
  const { camera,controls,invalidate,size }=useThree();
  const [hovered,setHovered]=useState<string|null>(null);
  const motion=useRef({ cameraPosition:new THREE.Vector3(),target:new THREE.Vector3(),overview:new THREE.Box3(),cameraActive:false });
  const reducedMotion=useRef(false);
  const entries=useMemo(() => {
    scene.updateWorldMatrix(true,true);
    const box=new THREE.Box3().setFromObject(scene);
    const center=box.getCenter(new THREE.Vector3());
    const scale=2.7/box.getSize(new THREE.Vector3()).y;
    const normalization=new THREE.Matrix4().makeScale(scale,scale,scale).setPosition(center.multiplyScalar(-scale));
    const meshes=new Map<string,THREE.Mesh>();
    scene.traverse(node => { if (node instanceof THREE.Mesh) meshes.set(String(node.userData.id),node); });
    return anatomyStructures.map(structure => {
      const group=new THREE.Group();
      group.userData.id=structure.id;
      const parts=structure.parts.map(part => {
        const source=meshes.get(part.id);
        if (!source) throw new Error(`Missing model part: ${part.id}`);
        const mesh=new THREE.Mesh(source.geometry,new THREE.MeshStandardMaterial({ color:'#e8ddc4',roughness:.65,metalness:.05,side:THREE.DoubleSide }));
        mesh.applyMatrix4(normalization.clone().multiply(source.matrixWorld));
        mesh.userData={ ...source.userData,id:structure.id };
        group.add(mesh);return mesh;
      });
      return { ...structure,group,meshes:parts,box:new THREE.Box3().setFromObject(group),destination:new THREE.Vector3() };
    });
  },[scene]);
  const isolationId=isolate ? selected : null;
  const visible=useMemo(() => entries.filter(entry => (region==='all' || entry.region===region) && (!isolationId || entry.id===isolationId)),[entries,region,isolationId]);
  const layout=useMemo(() => layoutAnatomy(visible,size.width/size.height),[visible,size.width,size.height]);
  const targetBounds=useMemo(() => {
    const box=new THREE.Box3();
    for (const entry of visible) box.union(entry.box.clone().translate(layout.offsets.get(entry.id)!.clone().multiplyScalar(explode)));
    if (explode===1 && !isolationId) for (const section of layout.sections) box.union(section.box);
    return box;
  },[visible,layout,explode,isolationId]);
  useEffect(() => {
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const update=() => { reducedMotion.current=preference.matches;invalidate(); };
    update();preference.addEventListener('change',update);
    return () => preference.removeEventListener('change',update);
  },[invalidate]);
  useEffect(() => { onStatus('ready'); },[onStatus]);
  useEffect(() => () => { for (const entry of entries) for (const mesh of entry.meshes) (mesh.material as THREE.Material).dispose(); },[entries]);
  useEffect(() => {
    for (const entry of entries) {
      // 仅更新本组件创建的 Three.js 可变对象，不修改 props 或共享 GLTF 几何。
      // eslint-disable-next-line react-hooks/immutability
      entry.group.visible=visible.includes(entry);
      entry.destination.copy(layout.offsets.get(entry.id) ?? new THREE.Vector3()).multiplyScalar(explode);
      for (const mesh of entry.meshes) {
        mesh.raycast=entry.group.visible ? THREE.Mesh.prototype.raycast : () => {};
        const material=mesh.material as THREE.MeshStandardMaterial;
        material.color.set(entry.id===selected ? '#57c5b7' : entry.id===hovered ? '#c2d8be' : '#e8ddc4');
        material.emissive.set(entry.id===selected ? '#123f3a' : '#000000');
      }
    }
    invalidate();
  },[entries,visible,layout,selected,hovered,explode,invalidate]);
  // 结构/布局变化先适配全景；单纯选择高亮不改变用户镜头。
  useEffect(() => {
    if (targetBounds.isEmpty()) return;
    motion.current.overview.copy(targetBounds);
    const sphere=targetBounds.getBoundingSphere(new THREE.Sphere());
    const distance=fitAnatomyDistance(targetBounds,(camera as THREE.PerspectiveCamera).fov,size.width/size.height);
    motion.current.target.copy(sphere.center);
    motion.current.cameraPosition.copy(sphere.center).add(new THREE.Vector3(0,0,distance));
    motion.current.cameraActive=true;invalidate();
  },[targetBounds,camera,size.width,size.height,invalidate]);
  useEffect(() => {
    const orbit=controls as unknown as { target:THREE.Vector3;update:() => void }|null;
    if (!orbit) return;
    const current=motion.current;
    if (view.direction==='fit') {
      const sphere=current.overview.getBoundingSphere(new THREE.Sphere());
      const distance=fitAnatomyDistance(current.overview,(camera as THREE.PerspectiveCamera).fov,size.width/size.height);
      current.target.copy(sphere.center);current.cameraPosition.copy(sphere.center).add(new THREE.Vector3(0,0,distance));
    } else if (view.direction.startsWith('zoom-')) {
      const delta=(current.cameraActive ? current.cameraPosition.clone().sub(current.target) : camera.position.clone().sub(orbit.target));
      delta.setLength(THREE.MathUtils.clamp(delta.length()*(view.direction==='zoom-in' ? .8 : 1.25),.12,60));
      current.target.copy(orbit.target);current.cameraPosition.copy(current.target).add(delta);
    } else if (view.direction==='focus') {
      const entry=entries.find(item => item.id===view.targetId);
      if (!entry) return;
      const sphere=entry.box.clone().translate(entry.group.position).getBoundingSphere(new THREE.Sphere());
      const vertical=(camera as THREE.PerspectiveCamera).fov*Math.PI/180;
      const horizontal=2*Math.atan(Math.tan(vertical/2)*size.width/size.height);
      const distance=Math.max(.12,sphere.radius/Math.sin(Math.min(vertical,horizontal)/2)*1.2);
      current.target.copy(sphere.center);current.cameraPosition.copy(sphere.center).add(new THREE.Vector3(0,0,distance));
    } else {
      const delta=current.cameraPosition.clone().sub(current.target);
      const distance=Math.max(delta.length(),camera.position.distanceTo(orbit.target),.15);
      const direction=view.direction==='back' ? new THREE.Vector3(0,0,-1) : view.direction==='left' ? new THREE.Vector3(-1,0,0) : new THREE.Vector3(0,0,1);
      current.cameraPosition.copy(current.target).addScaledVector(direction,distance);
    }
    current.cameraActive=true;invalidate();
  },[view,camera,controls,entries,invalidate,size.width,size.height]);
  useFrame((_,delta) => {
    const alpha=reducedMotion.current ? 1 : 1-Math.exp(-7*Math.min(delta,.1));
    let moving=false;
    for (const entry of entries) {
      if (entry.group.position.distanceToSquared(entry.destination)<1e-8) entry.group.position.copy(entry.destination);
      else { entry.group.position.lerp(entry.destination,alpha);moving=true; }
    }
    const orbit=controls as unknown as { target:THREE.Vector3;update:() => void }|null;
    const current=motion.current;
    if (current.cameraActive && orbit) {
      camera.position.lerp(current.cameraPosition,alpha);orbit.target.lerp(current.target,alpha);orbit.update();
      current.cameraActive=camera.position.distanceToSquared(current.cameraPosition)>1e-8 || orbit.target.distanceToSquared(current.target)>1e-8;
      moving ||= current.cameraActive;
    }
    if (moving) invalidate();
  });
  return <group>
    {entries.map(entry => <primitive key={entry.id} object={entry.group} dispose={null}
      onClick={(event:{stopPropagation:() => void}) => { event.stopPropagation();onSelect(entry.id); }}
      onPointerOver={(event:{stopPropagation:() => void}) => { event.stopPropagation();setHovered(entry.id); }} onPointerOut={() => setHovered(null)}>
      {(selected===entry.id || hovered===entry.id) && <Html position={entry.box.getCenter(new THREE.Vector3()).toArray()} center style={{pointerEvents:'none'}}><span className="anatomy-structure-label">{entry.label}</span></Html>}
    </primitive>)}
    {explode===1 && !isolate && layout.sections.map(section => <Html key={section.region} position={[section.box.min.x,section.box.max.y,0]} style={{pointerEvents:'none'}}><span className="anatomy-region-label">{anatomyRegions[section.region]}</span></Html>)}
  </group>;
}
function ContextHealth({ onLost }: {onLost:() => void}) {
  const gl=useThree(state => state.gl);
  useEffect(() => {
    const handle=(event:Event) => { event.preventDefault();onLost(); };
    gl.domElement.addEventListener('webglcontextlost',handle);
    return () => gl.domElement.removeEventListener('webglcontextlost',handle);
  },[gl,onLost]);
  return null;
}
export default function AnatomyScene(props:Props) {
  const [contextLost,setContextLost]=useState(false);
  if (contextLost) return <ModelFailure onRetry={() => {props.onStatus('loading');setContextLost(false);}} />;
  return <ModelBoundary onStatus={props.onStatus}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{ position:[0,.2,4.8],fov:38,near:.01 }} gl={{ antialias:true,alpha:true }} onPointerMissed={() => props.onSelect(null)}>
    <ambientLight intensity={1.3} /><directionalLight position={[3,5,4]} intensity={2.5} /><directionalLight position={[-3,2,-4]} intensity={1.5} />
    <OrbitControls makeDefault enableDamping minDistance={.12} maxDistance={60} /><Suspense fallback={null}><Skeleton {...props} /></Suspense><ContextHealth onLost={() => {props.onStatus('error');setContextLost(true);}} />
  </Canvas></ModelBoundary>;
}
