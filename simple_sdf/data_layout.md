# Data Layout

To allow JavaScript to create, update, and remove objects at runtime, we need a way to transfer scene data from the CPU to the shader.

My initial idea was to use a memory layout similar to a C structure:

```c
vec3* pos;
vec3* flags;              // shape type, state flags, etc.
vec3* baseColor;
vec2* roughness_metallic; // roughness and metallic packed together
float radius;             // sphere radius or object scale
```

However, after some research, I discovered that WebGL 2 does not support Shader Storage Buffer Objects (SSBOs), which would normally be the preferred solution for large amounts of dynamic data.

Instead, scene data will be stored in floating-point textures. Specifically, an `RGBA32F` texture can store four 32-bit floating-point values per texel, making it suitable as a general-purpose data buffer.

## Entity Layout

Each scene object is represented by the following structure:

```c
struct Entity {
    vec4 rotation;   // 16 bytes (quaternion for rotation)
    vec3 position;   // 12 bytes
    vec3 baseColor;  // 12 bytes
    vec3 scale;      // 12 bytes
    float roughness; // 4 bytes
    float metallic;  // 4 bytes
    int type;        // 4 bytes (0=sphere, 1=box, 2=plane, ...)
    int flags;       // 4 bytes (active, shadow, etc.)
};
```

This layout requires 12 floating-point values in total.

## Texture Packing

The entity data is packed into an `RGBA32F` texture as follows:

- Texel 0: `(position.x, position.y, position.z, metallic)`
- Texel 1: `(baseColor.r, baseColor.g, baseColor.b, roughness)`
- Texel 2: `(type, flags, 0.0, 0.0)`
- Texel 3: `(rotation.x, rotation.y, rotation.z, rotation.w)`
- Texel 4: `(scale.x, scale.y, scale.z, 0.0)`

Using a texture-based layout allows an arbitrary number of entities to be uploaded from JavaScript and accessed efficiently from the fragment shader, providing functionality similar to a storage buffer while remaining compatible with WebGL 2.
