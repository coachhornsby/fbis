#!/usr/bin/env python3
"""Create transparent WebP Tennis portraits from APPROVED locally staged source images.

Does not scrape/obtain photographs or grant usage rights. Operator reviews every output
before it replaces a publicly served R2 asset. Dependencies:
  python -m pip install Pillow 'rembg[cpu]'
Usage:
  python scripts/prepare-tennis-portrait-cutouts.py --input-dir sourced --output-dir cutouts
Files expected: {canonical_player_id}.jpg/.jpeg/.png/.webp (e.g. tennis:wta:326408.jpg).
"""
import argparse
import io
import json
import re
from pathlib import Path

PLAYER_ID = re.compile(r"^tennis:(?:wta|atp):[a-z0-9:_ -]+$", re.I)
EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def cutout(image_bytes: bytes, max_width=960):
    from PIL import Image, ImageOps
    from rembg import remove
    source = Image.open(io.BytesIO(image_bytes))
    source = ImageOps.exif_transpose(source).convert("RGB")
    source.thumbnail((max_width, max_width * 2), Image.Resampling.LANCZOS)
    output = remove(source).convert("RGBA")
    alpha = output.getchannel("A")
    if not alpha.getbbox():
        raise ValueError("background removal produced an empty subject")
    bounds = alpha.getbbox()
    output = output.crop(bounds)
    # Place subject on a transparent stage; no synthesized faces or reused stock imagery.
    canvas_width = max(500, output.width)
    canvas_height = max(600, int(canvas_width * 1.12), output.height)
    if output.height > canvas_height:
        canvas_width = max(canvas_width, int(output.width * canvas_height / output.height))
    scale = min(canvas_width / output.width, canvas_height / output.height, 1)
    if scale < 1:
        output = output.resize((max(1, round(output.width*scale)),max(1,round(output.height*scale))),Image.Resampling.LANCZOS)
    stage = Image.new("RGBA",(canvas_width,canvas_height),(0,0,0,0))
    stage.alpha_composite(output,((canvas_width-output.width)//2,canvas_height-output.height))
    final=io.BytesIO()
    stage.save(final,format="WEBP",quality=89,method=5)
    return final.getvalue(), {"width":stage.width,"height":stage.height,"alpha_bbox":bounds}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--input-dir",type=Path,required=True)
    parser.add_argument("--output-dir",type=Path,required=True)
    parser.add_argument("--max-width",type=int,default=960)
    args=parser.parse_args()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    rows=[]
    for photo in sorted(args.input_dir.iterdir()):
        if photo.suffix.lower() not in EXTS:
            continue
        player_id=photo.stem
        if not PLAYER_ID.fullmatch(player_id):
            rows.append({"input":photo.name,"status":"SKIPPED_UNRESOLVED_ID"})
            continue
        try:
            data,stats=cutout(photo.read_bytes(),args.max_width)
            target=args.output_dir / f"{player_id}.webp"
            target.write_bytes(data)
            rows.append({"player_id":player_id,"input":photo.name,"output":target.name,
                         "target_r2_key":f"tennis/portraits/{player_id}/approved-cutout.webp",
                         "status":"NEEDS_VISUAL_REVIEW","bytes":len(data),**stats})
        except Exception as e:
            rows.append({"player_id":player_id,"input":photo.name,"status":"FAILED","error":str(e)[:400]})
    (args.output_dir/"review-manifest.json").write_text(json.dumps(rows,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"processed":sum(x["status"]=="NEEDS_VISUAL_REVIEW" for x in rows),
                      "failed":sum(x["status"]=="FAILED" for x in rows),
                      "review_manifest":str(args.output_dir/"review-manifest.json")}))
if __name__=="__main__":
    main()
