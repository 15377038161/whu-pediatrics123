'use client';
import { Component,Suspense,useEffect,useMemo,type ReactNode } from 'react';
import { Canvas,useThree } from '@react-three/fiber';
import { OrbitControls,useGLTF } from '@react-three/drei';
import * as THREE from 'three';
interface Props {
  explode:number; selected:string|null; region:string; isolate:boolean;
  view:{ direction:string;version:number }; onSelect:(id:string|null) => void;onReady:() => void;
}
class ModelBoundary extends Component<{ children:ReactNode },{ failed:boolean;attempt:number }> {
  state={ failed:false,attempt:0 };
  static getDerivedStateFromError() { return { failed:true }; }
  render() { return this.state.failed ? <div className="anatomy-loading" role="alert"><p>三维模型加载失败，请检查网络或浏览器 WebGL 支持。</p><button className="btn btn-secondary" onClick={() => { useGLTF.clear('/models/anatomy/piper-child-6yo.glb');this.setState({ failed:false,attempt:this.state.attempt+1 }); }}>重新加载</button></div> : <div key={this.state.attempt} className="anatomy-three">{this.props.children}</div>; }
}
function Skeleton({ explode,selected,region,isolate,onSelect,onReady }:Props) {
  const { scene }=useGLTF('/models/anatomy/piper-child-6yo.glb');
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
  useEffect(() => { onReady(); },[onReady]);
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
  const { camera,controls,invalidate }=useThree();
  useEffect(() => {
    const position=view.direction === 'back' ? [0,.2,-5.6] : view.direction === 'left' ? [-5.6,.2,0] : [0,.2,5.6];
    camera.position.set(position[0],position[1],position[2]);camera.lookAt(0,0,0);
    const orbit=controls as unknown as { target:THREE.Vector3;update:() => void }|null;
    orbit?.target.set(0,0,0);orbit?.update();invalidate();
  },[camera,controls,invalidate,view]);return null;
}
export default function AnatomyScene(props:Props) {
  return <ModelBoundary><Canvas frameloop="demand" dpr={[1,1.5]} camera={{ position:[0,.2,5.6],fov:38 }} gl={{ antialias:true,alpha:true }} onPointerMissed={() => props.onSelect(null)}>
    <ambientLight intensity={1.3} /><directionalLight position={[3,5,4]} intensity={2.5} /><directionalLight position={[-3,2,-4]} intensity={1.5} />
    <Suspense fallback={null}><Skeleton {...props} /></Suspense><OrbitControls makeDefault enableDamping minDistance={1.6} maxDistance={9} /><CameraView view={props.view} />
  </Canvas></ModelBoundary>;
}
