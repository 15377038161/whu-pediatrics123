'use client';
import { Component,Suspense,useEffect,useMemo,useState,type ReactNode } from 'react';
import { Canvas,useThree } from '@react-three/fiber';
import { OrbitControls,useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import manifest from '../../public/models/anatomy/manifest.json';
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
function Skeleton({ explode,selected,region,isolate,onSelect,onStatus }:Props) {
  const { scene }=useGLTF(MODEL_URL);
  const invalidate=useThree(state => state.invalidate);
  const { group,bones }=useMemo(() => {
    const group=scene.clone(true);
    const box=new THREE.Box3().setFromObject(group);
    const center=box.getCenter(new THREE.Vector3());
    const scale=2.7/box.getSize(new THREE.Vector3()).y;
    group.position.copy(center).multiplyScalar(-scale);group.scale.setScalar(scale);
    const bones:{ mesh:THREE.Mesh;base:THREE.Vector3;offset:THREE.Vector3 }[]=[];
    group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.material=new THREE.MeshStandardMaterial({ color:'#e8ddc4',roughness:.65,metalness:.05,side:THREE.DoubleSide });
      node.geometry.computeBoundingBox();
      const offset=node.geometry.boundingBox!.getCenter(new THREE.Vector3()).sub(center).multiplyScalar(.55);
      bones.push({ mesh:node,base:node.position.clone(),offset });
    });return { group,bones };
  },[scene]);
  useEffect(() => { onStatus('ready'); },[onStatus]);
  useEffect(() => () => { for (const bone of bones) (bone.mesh.material as THREE.Material).dispose(); },[bones]);
  useEffect(() => { for (const { mesh,base,offset } of bones) {
    const data=mesh.userData;
    // Three.js 克隆场景是可变渲染对象，未修改 React props 或共享 GLTF 缓存。
    // eslint-disable-next-line react-hooks/immutability
    mesh.visible=(region === 'all' || data.region === region) && (!isolate || data.id === selected);
    mesh.position.copy(base).addScaledVector(offset,explode);
    const material=mesh.material as THREE.MeshStandardMaterial;
    material.color.set(data.id === selected ? '#57c5b7' : '#e8ddc4');material.emissive.set(data.id === selected ? '#123f3a' : '#000000');
  } invalidate(); },[bones,region,isolate,selected,explode,invalidate]);
  return <primitive object={group} dispose={null} onClick={(event:{ stopPropagation:() => void;object:THREE.Object3D }) => { event.stopPropagation();if (event.object.userData.id) onSelect(event.object.userData.id); }} />;
}
function CameraView({ view }:Pick<Props,'view'>) {
  const { camera,controls,invalidate,scene,size }=useThree();
  useEffect(() => {
    const orbit=controls as unknown as { target:THREE.Vector3;update:() => void }|null;
    if (!orbit) return;
    if (view.direction.startsWith('zoom-')) {
      const delta=camera.position.clone().sub(orbit.target);
      delta.setLength(THREE.MathUtils.clamp(delta.length()*(view.direction==='zoom-in' ? .8 : 1.25),.12,9));
      camera.position.copy(orbit.target).add(delta);orbit.update();invalidate();return;
    }
    if (view.direction === 'focus') {
      let target:THREE.Object3D|undefined;
      scene.traverse(node => { if (node.userData.id === view.targetId) target=node; });
      if (!target) return;
      target.updateWorldMatrix(true,false);
      const sphere=new THREE.Box3().setFromObject(target).getBoundingSphere(new THREE.Sphere());
      const vertical=(camera as THREE.PerspectiveCamera).fov*Math.PI/180;
      const horizontal=2*Math.atan(Math.tan(vertical/2)*size.width/size.height);
      const distance=THREE.MathUtils.clamp(sphere.radius/Math.sin(Math.min(vertical,horizontal)/2)*1.2,.12,9);
      const direction=camera.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(sphere.center);camera.position.copy(sphere.center).addScaledVector(direction,distance);
      orbit.update();invalidate();return;
    }
    const position=view.direction === 'back' ? [0,.2,-4.8] : view.direction === 'left' ? [-4.8,.2,0] : [0,.2,4.8];
    camera.position.set(position[0],position[1],position[2]);camera.lookAt(0,0,0);
    orbit?.target.set(0,0,0);orbit?.update();invalidate();
  },[camera,controls,invalidate,view,scene,size.width,size.height]);return null;
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
    <Suspense fallback={null}><Skeleton {...props} /></Suspense><OrbitControls makeDefault enableDamping minDistance={.12} maxDistance={9} /><CameraView view={props.view} /><ContextHealth onLost={() => {props.onStatus('error');setContextLost(true);}} />
  </Canvas></ModelBoundary>;
}
