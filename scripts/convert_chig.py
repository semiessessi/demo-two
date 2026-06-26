"""Convert the Chig fighter from 3MF (geometry-only print format) to GLB.

Blender 3.5 has no 3MF importer, so we use trimesh: load the 3MF (force a single
merged mesh), weld vertices, ensure normals, and export a GLB. There are no
textures/materials in the 3MF — the shiny-black look is applied in-engine.
"""
import sys
import trimesh

src, out = sys.argv[1], sys.argv[2]

loaded = trimesh.load(src, force='mesh')  # concatenate any parts into one Trimesh
mesh = loaded if isinstance(loaded, trimesh.Trimesh) else trimesh.util.concatenate(loaded.dump())
mesh.merge_vertices()
mesh.update_faces(mesh.nondegenerate_faces())  # drop zero-area faces
mesh.fix_normals()
_ = mesh.vertex_normals  # force computation so the GLB carries NORMALs

mesh.export(out)
print('[chig] exported', out, '| verts', len(mesh.vertices), 'faces', len(mesh.faces))
