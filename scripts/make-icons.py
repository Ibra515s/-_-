from PIL import Image, ImageDraw
import os
os.makedirs('public/icons', exist_ok=True)
def icon(size, maskable=False):
    S=size*4
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    bg=(15,107,79,255)
    if maskable: d.rectangle([0,0,S,S],fill=bg)
    else: d.rounded_rectangle([0,0,S-1,S-1],radius=int(S*0.22),fill=bg)
    k=0.62 if maskable else 0.74
    cx,cy,r=S/2,S/2,S*0.5*k*0.62
    d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=(255,255,255,255))
    r2=r*0.82; ox=r*0.42
    d.ellipse([cx-r2+ox,cy-r2-r*0.12,cx+r2+ox,cy+r2-r*0.12],fill=bg)
    return im.resize((size,size),Image.LANCZOS)
icon(192).save('public/icons/icon-192.png'); icon(512).save('public/icons/icon-512.png'); icon(512,True).save('public/icons/icon-maskable-512.png')
icon(180).save('public/icons/apple-touch-icon.png')
