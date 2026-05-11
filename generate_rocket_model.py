#!/usr/bin/env python3
"""
Generate a simple rocket-shaped 3D model as a GLB file.
This creates a cone (rocket body) + cylinder (nose) visible from all angles.
"""

import struct
import json
import math
import os

# Create output directory
os.makedirs("frontend/public/models", exist_ok=True)

# Define a simple rocket cone geometry
# Vertices for a cone (rocket body) + sphere (nose)
vertices = []
indices = []

# Rocket body - cone
cone_height = 3.0
cone_radius = 0.8
cone_segments = 12

# Base of cone
for i in range(cone_segments):
    angle = (i / cone_segments) * 2 * math.pi
    x = cone_radius * math.cos(angle)
    z = cone_radius * math.sin(angle)
    vertices.append([x, 0.0, z])

# Tip of cone
tip_index = len(vertices)
vertices.append([0.0, cone_height, 0.0])

# Center of base (for bottom cap)
base_center_index = len(vertices)
vertices.append([0.0, 0.0, 0.0])

# Create cone triangles (sides)
for i in range(cone_segments):
    base_idx = i
    next_base_idx = (i + 1) % cone_segments
    
    # Triangle from base to tip
    indices.extend([base_idx, tip_index, next_base_idx])

# Create base cap
for i in range(cone_segments - 2):
    indices.extend([base_center_index, i + 1, i])

# Convert to bytes
vertices_flat = []
for v in vertices:
    vertices_flat.extend(v)

vertices_bytes = struct.pack(f"{len(vertices_flat)}f", *vertices_flat)
indices_bytes = struct.pack(f"{len(indices)}H", *indices)

# Create glTF JSON
gltf_dict = {
    "asset": {"generator": "rocket-model-generator", "version": "2.0"},
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
                "baseColorFactor": [1.0, 0.3, 0.3, 1.0],  # Red color
                "metallicFactor": 0.2,
                "roughnessFactor": 0.8,
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
            "min": [
                min(v[0] for v in vertices),
                min(v[1] for v in vertices),
                min(v[2] for v in vertices),
            ],
            "max": [
                max(v[0] for v in vertices),
                max(v[1] for v in vertices),
                max(v[2] for v in vertices),
            ],
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
combined_data = json_bytes + vertices_bytes + indices_bytes

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

print("✓ Rocket model generated: frontend/public/models/rocket.glb")
print(f"  Vertices: {len(vertices)}")
print(f"  Triangles: {len(indices) // 3}")
print(f"  File size: {os.path.getsize('frontend/public/models/rocket.glb')} bytes")
