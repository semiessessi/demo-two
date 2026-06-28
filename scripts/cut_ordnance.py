# Headless Blender ordnance surgery for the SA-43 Hammerhead.
#
# The fuel tanks + "bomb" stations are fused into the hull's `Fuselage` mesh. The user isolated them
# (boolean) into hammerhead-1-just-tanks.fbx / -just-bombs.fbx, where each part = a BODY (faces shared
# with the hull, ~99% coincident) + a boolean CAP (the few new faces that mate flush to the wing
# underside). This script:
#   1. removes the fused part bodies from the Fuselage (delete coincident faces),
#   2. patches each hole with that part's CAP, kept as a flush plate joined into the Fuselage,
#   3. emits the tank bodies as separate named meshes (Tank_L / Tank_R) for the in-game loadout,
#   4. drops the bomb bodies (never used) but keeps their cap plates (those become missile/laser mounts),
#   5. assigns the SA43 material (Texture2 UV) to everything new and exports a GLB (all ship parts).
#
# Usage: blender --background --python scripts/cut_ordnance.py -- <SA-43.fbx> <tanks.fbx> <bombs.fbx> <out.glb>

import bpy, bmesh, sys
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, TANKS, BOMBS, OUT = argv[0], argv[1], argv[2], argv[3]
EPS = 1e-3

def log(*a): print('[cut]', *a)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
fus = bpy.data.objects['Fuselage']
sa43 = fus.data.materials[0]  # the SA43 material (with its textures, from the FBX import)
log('Fuselage', len(fus.data.vertices), 'verts; material', sa43.name)

# KDTree of Fuselage world-space verts (for coincidence tests + mapping to hull vert indices)
fw = [fus.matrix_world @ v.co for v in fus.data.vertices]
kd = KDTree(len(fw))
for i, co in enumerate(fw):
    kd.insert(co, i)
kd.balance()

def import_parts(path, before):
    bpy.ops.import_scene.fbx(filepath=path)
    return [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in before and bpy.data.objects[n].type == 'MESH']

def vert_on_hull(obj):
    """Per-vertex: (is_on_hull, hull_vert_index). Body verts coincide with the hull; cap verts don't."""
    out = []
    for v in obj.data.vertices:
        co = obj.matrix_world @ v.co
        _, idx, dist = kd.find(co)
        out.append((dist < EPS, idx))
    return out

def split_obj(obj, keep_body, new_name):
    """Duplicate obj keeping only body faces (keep_body=True) or only cap faces (False). Returns the dup, or None if empty."""
    onh = vert_on_hull(obj)
    dup = obj.copy(); dup.data = obj.data.copy(); dup.name = new_name; dup.data.name = new_name
    bpy.context.scene.collection.objects.link(dup)
    bm = bmesh.new(); bm.from_mesh(dup.data); bm.verts.ensure_lookup_table()
    todel = []
    for f in bm.faces:
        is_body = all(onh[v.index][0] for v in f.verts)
        if is_body != keep_body:
            todel.append(f)
    bmesh.ops.delete(bm, geom=todel, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    n = len(bm.faces)
    bm.to_mesh(dup.data); bm.free()
    if n == 0:
        bpy.data.objects.remove(dup, do_unlink=True); return None
    # SA43 material + Texture2 as the active UV (matches the hull's texture mapping)
    dup.data.materials.clear(); dup.data.materials.append(sa43)
    for p in dup.data.polygons: p.material_index = 0
    if 'Texture2' in dup.data.uv_layers: dup.data.uv_layers.active = dup.data.uv_layers['Texture2']
    return dup

hull_body_idx = set()  # Fuselage vert indices covered by any part body -> their faces get deleted

def process(part, base_name, keep_body_mesh):
    onh = vert_on_hull(part)
    for (on, idx) in onh:
        if on: hull_body_idx.add(idx)
    cap = split_obj(part, False, base_name + '_cap')
    if cap: cap.name = base_name + '_cap'
    body = split_obj(part, True, base_name) if keep_body_mesh else None
    bpy.data.objects.remove(part, do_unlink=True)  # the original isolated import no longer needed
    return cap, body

# tanks -> keep bodies as Tank_L / Tank_R ; bombs -> drop bodies, keep cap plates only
caps = []
for fbx, prefix, keep in ((TANKS, 'Tank', True), (BOMBS, 'BombStn', False)):
    before = set(bpy.data.objects.keys())
    parts = import_parts(fbx, before)
    for o in parts:
        side = 'L' if ('.L' in o.name or 'L1' in o.name) else 'R'  # name by the source object (Tank.L1 / Tank.R1)
        cap, body = process(o, f'{prefix}_{side}', keep)
        if cap: caps.append(cap)
        if body: log('part', body.name, len(body.data.polygons), 'faces')

# delete the fused part bodies from the Fuselage (faces with all verts coincident with a part body)
bm = bmesh.new(); bm.from_mesh(fus.data); bm.verts.ensure_lookup_table()
todel = [f for f in bm.faces if all(v.index in hull_body_idx for v in f.verts)]
log('Fuselage faces removed:', len(todel), 'of', len(bm.faces))
bmesh.ops.delete(bm, geom=todel, context='FACES')
bm.to_mesh(fus.data); bm.free()

# join the cap plates into the Fuselage so the hull always shows a flush panel (no hole)
if caps:
    bpy.ops.object.select_all(action='DESELECT')
    for c in caps: c.select_set(True)
    fus.select_set(True); bpy.context.view_layer.objects.active = fus
    bpy.ops.object.join()
    log('joined', len(caps), 'cap plates into Fuselage')

# drop the in-space-hidden meshes (deployed gear + hangar floor) so their textures don't bloat the GLB;
# ship.js hides these anyway. The closed gear doors stay.
for name in ('Ground', 'Gear'):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
        log('pruned hidden mesh', name)

log('exporting', OUT)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True)
log('done; objects:', [o.name for o in bpy.data.objects if o.type == 'MESH'])
