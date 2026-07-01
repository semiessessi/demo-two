import bpy
import sys

# args after `--`: input STL, output GLB
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)

# import the STL (bare geometry — no UVs/materials)
bpy.ops.import_mesh.stl(filepath=src)
obj = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = obj

# recompute normals + Smart-UV-unwrap so a texture can be painted onto it later
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)  # angle_limit in radians (~66deg)
bpy.ops.object.mode_set(mode='OBJECT')

print('[saratoga] verts', len(obj.data.vertices), 'polys', len(obj.data.polygons), 'uv layers', len(obj.data.uv_layers))

# export a clean GLB (binary), Y-up, with the new UVs
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
)
print('[saratoga] wrote', out)
