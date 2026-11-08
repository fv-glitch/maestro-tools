import re,sys,zipfile
def load(p):
    z=zipfile.ZipFile(p); return z.read([n for n in z.namelist() if n.endswith('.xml')][0]).decode('utf-8')
def extract(p):
    t=load(p)
    planes={m.group(1):m.group(2) for m in re.finditer(r'<Plane[^>]*><Key[^>]*><ID>(\d+)</ID><ObjectType>[^<]*</ObjectType></Key><Name[^>]*>([^<]*)<',t)}
    w=t.index('<MainWorkplan>'); 
    rows=[]
    # iterate executables in document order; track enabled VSP spans
    vsp_spans=[]
    for m in re.finditer(r'<Executable i:type="VisualSubProgram"><Key[^>]*><ID>(\d+)</ID>.*?<Name[^>]*>([^<]*)</Name><Description/><IsEnabled>(\w+)',t):
        e=t.index('</FileName></Executable>',m.start()); vsp_spans.append((m.start(),e,m.group(2),m.group(3)=='true'))
    for m in re.finditer(r'<Executable i:type="(a:MachiningWorkingStep|Xn|Xmsg)"[^>]*><Key[^>]*><ID>(\d+)</ID>.*?<Name[^>]*>([^<]*)</Name><Description/><IsEnabled>(\w+)',t):
        if m.start()<w: continue
        inst=[v for v in vsp_spans if v[0]<m.start()<v[1]]
        if inst and not inst[0][3]: continue
        if m.group(4)!='true': continue
        typ=m.group(1)
        if typ!='a:MachiningWorkingStep':
            txt=''
            if typ=='Xmsg':
                tm=re.search(r'</WorkPieceID>.*?<(\w+:)?(?:Message|Text)>([^<]*)',t[m.start():m.start()+3000],re.S)
            rows.append((typ,m.group(3),'','','','','','')); continue
        s=t[m.start():t.index('</Executable>',m.start())]
        fid=re.search(r'ManufacturingFeatureID[^>]*><b:ID>(\d+)<',s).group(1); oid=re.search(r'OperationID[^>]*><b:ID>(\d+)',s).group(1)
        f=re.search(r'<ManufacturingFeature i:type="([^"]+)"[^>]*><Key[^>]*><ID>'+fid+'</ID>.*?</ManufacturingFeature>',t,re.S)
        gid=re.search(r'<GeometryID[^>]*><b:ID>(\d+)',f.group(0)).group(1)
        g=re.search(r'<a:GeomGeometry i:type="a:\w+"[^>]*><Key[^>]*><ID>'+gid+'</ID>.*?</a:GeomGeometry>',t,re.S).group(0)
        o=re.search(r'<Operation i:type="([^"]+)"[^>]*><Key[^>]*><ID>'+oid+'</ID>.*?</Operation>',t,re.S)
        pid=re.search(r'<a:PlaneID[^>]*><b:ID>(\d+)',g).group(1); pl=planes.get(pid,'gen'+pid[-4:])
        pts=[(float(a),float(b)) for a,b in re.findall(r'(?:\n|>)[12] (\S+) (\S+) ',g)]+[(float(a),float(b)) for a,b in re.findall(r'_x>([^<]+)</\w*:?_x>\s*<\w*:?_y>([^<]+)<',g)]
        if not pts: pts=[(float(a),float(b)) for a,b in zip(re.findall(r'_x>([^<]+)<',g),re.findall(r'_y>([^<]+)<',g))]
        xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
        dep=re.search(r'<EndDepth>([^<]*)',f.group(0)); dia=re.search(r'<a:Diameter>([^<]*)',f.group(0))
        tool=re.search(r'<ToolKey[^>]*>.*?<\w*:?Name>([^<]*)',o.group(0),re.S)
        ext=f'x{min(xs):.2f}..{max(xs):.2f} y{min(ys):.2f}..{max(ys):.2f}' if xs else '?'
        rows.append((f.group(1).split(':')[-1], m.group(3), (inst[0][2] if inst else '-'), pl, dep and dep.group(1), dia and dia.group(1), tool and tool.group(1), ext))
    return rows
if __name__=='__main__':
    for r in extract(sys.argv[1]): print(' | '.join(str(x) for x in r))
