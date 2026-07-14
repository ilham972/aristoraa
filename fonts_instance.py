from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont

def inst(src, axes, out, family, subfamily):
    f = TTFont(src); instantiateVariableFont(f, axes, inplace=True); name = f["name"]
    for nid, val in [(1,family),(2,subfamily),(4,f"{family} {subfamily}"),
                     (6,f"{family}-{subfamily}".replace(' ','')),(16,family),(17,subfamily)]:
        name.setName(val, nid, 3, 1, 0x409); name.setName(val, nid, 1, 0, 0)
    f.save(out); print("saved", out)

for w,sf in [(400,"Regular"),(500,"Medium"),(600,"SemiBold"),(700,"Bold")]:
    inst("fonts/NotoSansTamil-VF.ttf", {"wght":w,"wdth":100}, f"fonts/NSTamil-{sf}.ttf", "NSTamil", sf)
for w,sf in [(500,"Medium"),(600,"SemiBold"),(700,"Bold")]:
    inst("fonts/NotoSerifTamil-VF.ttf", {"wght":w,"wdth":100}, f"fonts/NSerifTamil-{sf}.ttf", "NSerifTamil", sf)
inst("fonts/Fraunces-VF.ttf", {"wght":600,"opsz":120,"SOFT":0,"WONK":0}, "fonts/Fraunces-SemiBold.ttf", "FrauncesDisp", "SemiBold")
inst("fonts/Fraunces-VF.ttf", {"wght":380,"opsz":40,"SOFT":0,"WONK":0},  "fonts/Fraunces-Reg.ttf",      "FrauncesText", "Regular")
