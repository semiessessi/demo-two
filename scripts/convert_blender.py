import bpy
import sys

# args after `--`
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]

# start from an empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# import the FBX (Blender resolves the external textures relative to the FBX dir)
bpy.ops.import_scene.fbx(filepath=src)

print('[convert] imported objects:', [o.name for o in bpy.data.objects])

# export a clean GLB (binary), applying modifiers; embed images
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_apply=True,
    export_yup=True,
)
print('[convert] wrote', out)
