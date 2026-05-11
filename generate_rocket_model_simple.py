#!/usr/bin/env python3
"""
Generate a simple visible cube as a rocket placeholder model.
This will be a large, red, easily-visible cube.
"""

import struct
import json
import os

# Create output directory
os.makedirs("frontend/public/models", exist_ok=True)

# Define a simple cube (much larger than cone for visibility)
# Scale: 50 units (will be scaled down in Three.js if needed)
size = 50

# 8 vertices of a cube
vertices = [
    [-size, 0, -size],    # 0: Bottom-left-front
    [size, 0, -size],     # 1: Bottom-right-front
    [size, 0, size],      # 2: Bottom-right-back
    [-size, 0, size],     # 3: Bottom-left-back
    [-size, size*2, -size], # 4: Top-left-front
    [size, size*2, -size],  # 5: Top-right-front
    [size, size*2, size],   # 6: Top-right-back
    [-size, size*2, size],  # 7: Top-left-back
]

# Indices for cube triangles (2 per face, 6 faces)
indices = [
    # Bottom face
    0, 2, 1, 0, 3, 2,
    # Top face
    4, 5, 6, 4, 6, 7,
    # Front face
    0, 1, 5, 0, 5, 4,
    # Back face
    2, 3, 7, 2, 7, 6,
    # Left face
    0, 4, 7, 0, 7, 3,
    # Right face
    1, 2, 6, 1, 6, 5,
]

# Convert to bytes
vertices_flat = []
for v in vertices:
    vertices_flat.extend(v)

vertices_bytes = struct.pack(f"{len(vertices_flat)}f", *vertices_flat)
indices_bytes = struct.pack(f"{len(indices)}H", *indices)

# Create glTF JSON
gltf_dict = {
    "asset": {"generator": "rocket-cube-generator", "version": "2.0"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0}],
    "meshes": [
        {
            "primitives": [
                {
                    "attributes": {"POSITION": 0},
                    "indices": 1,
                    "material": 0,
                }
            ]
        }
    ],
    "materials": [
        {
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 0.2, 0.2, 1.0],  # Bright red color
                "metallicFactor": 0.3,
                "roughnessFactor": 0.7,
            },
            "name": "RocketMaterial",
        }
    ],
    "accessors": [
        {
            "bufferView": 0,
            "componentType": 5126,  # FLOAT
            "count": len(vertices),
            "type": "VEC3",
            "min": [-size, 0, -size],
            "max": [size, size*2, size],
        },
        {
            "bufferView": 1,
            "componentType": 5123,  # UNSIGNED_SHORT
            "count": len(indices),
            "type": "SCALAR",
        },
    ],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(vertices_bytes)},
        {
            "buffer": 0,
            "byteOffset": len(vertices_bytes),
            "byteLength": len(indices_bytes),
        },
    ],
    "buffers": [{"byteLength": len(vertices_bytes) + len(indices_bytes)}],
}

# Serialize glTF JSON to bytes
json_str = json.dumps(gltf_dict, separators=(",", ":"))
json_bytes = json_str.encode("utf-8")

# Pad JSON to 4-byte boundary
json_padding = (4 - (len(json_bytes) % 4)) % 4
json_bytes += b"\x20" * json_padding

# Combine data
combined_data = json_bytes

# GLB header
glb_header = struct.pack(
    "<III",
    0x46546C67,  # magic "glTF"
    2,  # version
    12 + 8 + len(json_bytes) + 8 + len(vertices_bytes) + len(indices_bytes),  # total file size
)

# JSON chunk header
json_chunk_header = struct.pack("<II", len(json_bytes), 0x4E4F534A)  # "JSON"

# BIN chunk header
bin_chunk_size = len(vertices_bytes) + len(indices_bytes)
bin_chunk_header = struct.pack("<II", bin_chunk_size, 0x004E4942)  # "BIN"

# Write GLB file
with open("frontend/public/models/rocket.glb", "wb") as f:
    f.write(glb_header)
    f.write(json_chunk_header)
    f.write(json_bytes)
    f.write(bin_chunk_header)
    f.write(vertices_bytes)
    f.write(indices_bytes)

print(f"✅ Generated cube-based rocket model: frontend/public/models/rocket.glb")
print(f"   Size: {len(vertices)} vertices, {len(indices)} indices")
print(f"   File size: {os.path.getsize('frontend/public/models/rocket.glb')} bytes")
