#!/usr/bin/env python3
import pathlib,tarfile,hashlib,json,sys
source=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
groups=[];current=[];size=0
for p in sorted(source.iterdir()):
 if not p.is_file():continue
 n=p.stat().st_size
 if current and size+n>8*1024*1024:groups.append(current);current=[];size=0
 current.append(p);size+=n
if current:groups.append(current)
manifest=[]
for i,group in enumerate(groups):
 tmp=out/f'block-{i:04d}.tar'
 with tarfile.open(tmp,'w') as tar:
  for p in group:
   info=tar.gettarinfo(str(p),arcname=p.name);info.mtime=0;info.uid=0;info.gid=0;info.uname='';info.gname=''
   with p.open('rb') as f:tar.addfile(info,f)
 digest=hashlib.sha256(tmp.read_bytes()).hexdigest();name=f'block-{i:04d}-{digest}.tar';tmp.rename(out/name)
 manifest.append({'name':name,'sha256':digest,'bytes':(out/name).stat().st_size,'files':[p.name for p in group]})
(out/'drive-blocks.json').write_text(json.dumps({'contract':'fbis-drive-archive-blocks-v1','blocks':manifest},indent=2)+'\n')
print(json.dumps({'driveBlocks':len(manifest),'bytes':sum(x['bytes'] for x in manifest)}))
