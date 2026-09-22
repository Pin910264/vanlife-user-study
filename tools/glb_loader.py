import struct, json, numpy as np, cv2
CT={5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def load(path):
    """Returns list of primitives: dict(V (N,3,3) world verts, UV (N,3,2) or None, tex HxWx4 float or None, factor rgb, alpha mode, node name)."""
    b=open(path,'rb').read(); ln=struct.unpack_from('<I',b,12)[0]; j=json.loads(b[20:20+ln])
    off=20+ln; bl=struct.unpack_from('<I',b,off)[0]; bin_=b[off+8:off+8+bl]
    def acc(i):
        a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
        dt=np.dtype(CT[a['componentType']]); n=NC[a['type']]
        start=bv.get('byteOffset',0)+a.get('byteOffset',0); stride=bv.get('byteStride',dt.itemsize*n)
        if stride==dt.itemsize*n: return np.frombuffer(bin_,dt,a['count']*n,start).reshape(a['count'],n)
        return np.array([np.frombuffer(bin_,dt,n,start+k*stride) for k in range(a['count'])])
    imgcache={}
    def image(ti):
        src=j['textures'][ti]['source']
        if src in imgcache: return imgcache[src]
        bv=j['bufferViews'][j['images'][src]['bufferView']]
        raw=np.frombuffer(bin_,np.uint8,bv['byteLength'],bv.get('byteOffset',0))
        im=cv2.imdecode(raw,cv2.IMREAD_UNCHANGED)
        if im is None: imgcache[src]=None; return None
        if im.ndim==2: im=cv2.cvtColor(im,cv2.COLOR_GRAY2BGRA)
        elif im.shape[2]==3: im=cv2.cvtColor(im,cv2.COLOR_BGR2BGRA)
        im=cv2.cvtColor(im,cv2.COLOR_BGRA2RGBA).astype(np.float32)/255
        # keep sampling cheap: downsize huge textures
        while im.shape[0]*im.shape[1]>1024*1024: im=cv2.resize(im,(im.shape[1]//2,im.shape[0]//2),interpolation=cv2.INTER_AREA)
        imgcache[src]=im; return im
    def material(mi):
        m=j['materials'][mi] if mi is not None else {}
        pbr=m.get('pbrMetallicRoughness',{}); fac=pbr.get('baseColorFactor',[1,1,1,1])
        tex=None; tt=None; tc=0
        if 'baseColorTexture' in pbr:
            bt=pbr['baseColorTexture']; tex=image(bt['index']); tc=bt.get('texCoord',0)
            tt=bt.get('extensions',{}).get('KHR_texture_transform')
        return dict(factor=np.array(fac[:3],np.float32),tex=tex,tt=tt,tc=tc,alpha=m.get('alphaMode','OPAQUE'),ds=m.get('doubleSided',False))
    def node_mat(nd):
        if 'matrix' in nd: return np.array(nd['matrix'],dtype=np.float64).reshape(4,4).T
        t=nd.get('translation',[0,0,0]); x,y,z,w=nd.get('rotation',[0,0,0,1]); s=nd.get('scale',[1,1,1])
        R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
        M=np.eye(4); M[:3,:3]=R*np.array(s); M[:3,3]=t; return M
    prims=[]
    def walk(ni,parent):
        nd=j['nodes'][ni]; M=parent@node_mat(nd)
        if 'mesh' in nd:
            for prim in j['meshes'][nd['mesh']]['primitives']:
                if prim.get('mode',4)!=4: continue
                P=acc(prim['attributes']['POSITION']).astype(np.float64); P=(M[:3,:3]@P.T).T+M[:3,3]
                idx=acc(prim['indices']).reshape(-1) if 'indices' in prim else np.arange(len(P)); F=idx.reshape(-1,3)
                mat=material(prim.get('material')); UV=None
                key='TEXCOORD_%d'%mat['tc']
                if mat['tex'] is not None and key in prim['attributes']:
                    uv=acc(prim['attributes'][key]).astype(np.float64)
                    if mat['tt']:
                        o=np.array(mat['tt'].get('offset',[0,0])); s=np.array(mat['tt'].get('scale',[1,1])); r=mat['tt'].get('rotation',0)
                        c,sn=np.cos(r),np.sin(r); uv=uv*s; uv=np.stack([uv[:,0]*c+uv[:,1]*sn,-uv[:,0]*sn+uv[:,1]*c],1)+o
                    UV=uv[F]
                prims.append(dict(V=P[F],UV=UV,tex=mat['tex'] if UV is not None else None,factor=mat['factor'],alpha=mat['alpha'],ds=mat['ds'],node=nd.get('name','')))
        for c in nd.get('children',[]): walk(c,M)
    for r in j['scenes'][j.get('scene',0)]['nodes']: walk(r,np.eye(4))
    return prims
