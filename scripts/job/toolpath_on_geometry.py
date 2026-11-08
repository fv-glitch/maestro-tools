import re,sys,zipfile
def load(p):
    z=zipfile.ZipFile(p); return z.read([n for n in z.namelist() if n.endswith('.xml')][0]).decode('utf-8')
for p in sys.argv[1:]:
    t=load(p); DX1=float(re.search(r'<a:Length>([^<]*)</a:Length>',t).group(1))
    vals=dict(re.findall(r'<Name[^>]*>(dx1|dy1|dz1)</Name>.*?<_serializedValue[^>]*>([^<]*)<',t[:t.find('<Executable')]))
    planes={m.group(1):m.group(2) for m in re.finditer(r'<Plane[^>]*><Key[^>]*><ID>(\d+)</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>([^<]*)<',t)}
    from collections import OrderedDict
    print('==',p.split('/')[-1])
    # enabled steps: inside enabled instances or top-level
    for st in re.finditer(r'<Executable i:type="a:MachiningWorkingStep"[^>]*><Key[^>]*><ID>(\d+)</ID>.*?<Name[^>]*>([^<]*)</Name><Description/><IsEnabled>(\w+).*?ManufacturingFeatureID[^>]*><b:ID>(\d+)<.*?OperationID[^>]*><b:ID>(\d+)',t,re.S):
        if st.group(3)!='true': continue
        vsp=t.rfind('<Executable i:type="VisualSubProgram">',0,st.start()); 
        if vsp>=0 and t.find('</FileName></Executable>',vsp)>st.start():
            hdr=re.search(r'<Name[^>]*>([^<]*)</Name><Description/><IsEnabled>(\w+)',t[vsp:vsp+1500]); inst=hdr.group(1)
            if hdr.group(2)!='true': continue
        else: inst='-'
        f=re.search(r'<ManufacturingFeature i:type="[^"]+"[^>]*><Key[^>]*><ID>'+st.group(4)+'</ID>.*?</ManufacturingFeature>',t,re.S).group(0)
        gid=re.search(r'<GeometryID[^>]*><b:ID>(\d+)',f).group(1)
        g=re.search(r'<a:GeomGeometry i:type="a:\w+"[^>]*><Key[^>]*><ID>'+gid+'</ID>.*?</a:GeomGeometry>',t,re.S).group(0)
        pl=planes.get(re.search(r'<a:PlaneID[^>]*><b:ID>(\d+)',g).group(1),'?')
        gx=[float(v) for v in re.findall(r'(?:\n|>)[12] (\S+) \S+ ',g)]+[float(v) for v in re.findall(r'_x>([^<]+)<',g)]
        o=re.search(r'<Operation i:type="[^"]+"[^>]*><Key[^>]*><ID>'+st.group(5)+'</ID>.*?</Operation>',t,re.S).group(0)
        ox=[float(v) for v in re.findall(r'\n[12] (\S+) \S+ \S+ ',o)]
        oy=[float(v) for v in re.findall(r'\n[12] \S+ (\S+) \S+ ',o)]
        if not gx or not ox: continue
        gc=(min(gx)+max(gx))/2; w= DX1-gc if pl=='Back' else gc
        oc=(min(ox)+max(ox))/2
        if 'Hinge' in pl or 'Generated' in pl: continue
        flag='' if abs(w-oc)<1.0 else '  <-- MISMATCH'
        print(f'  {inst[:28]:28} {st.group(2)[:22]:22} {pl:5} geom-world X {w:8.2f}  toolpath X {oc:8.2f}  toolpath Y {min(oy):7.2f}..{max(oy):7.2f}{flag}')
