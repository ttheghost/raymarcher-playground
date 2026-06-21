// uniform vec2  iResolution;
// uniform float iTime;
// uniform vec4  iMouse;
// uniform sampler2D iEntityTexture;
// uniform int iEntityCount;

#define MAX_STEPS 150
#define MAX_DIST 30.
#define SURF_DIST .001
#define MAX_BOUNCES 3

const uint SPHERE = 0u;
const uint BOX = 1u;
const uint PLANE = 2u;
const uint TORUS = 3u;

// Helper
vec4 quatConjugate(vec4 q)
{
    return vec4(-q.xyz, q.w);
}

vec3 quatRotate(vec4 q, vec3 v)
{
    return v + 2.0 * cross(q.xyz,
                           cross(q.xyz, v) + q.w * v);
}

void getEntityData(int index, out vec4 rot, out vec3 pos, out vec3 color, out vec3 scale,
    out float roughness, out float metallic, out uint type, out uint flags)
{
    int base = index * 5;

    vec4 texel_0 = texelFetch(iEntityTexture, ivec2(base, 0), 0);
    vec4 texel_1 = texelFetch(iEntityTexture, ivec2(base + 1, 0), 0);
    vec4 texel_2 = texelFetch(iEntityTexture, ivec2(base + 2, 0), 0);
    vec4 texel_3 = texelFetch(iEntityTexture, ivec2(base + 3, 0), 0);
    vec4 texel_4 = texelFetch(iEntityTexture, ivec2(base + 4, 0), 0);

    pos = texel_0.xyz;
    metallic = texel_0.w;
    color = texel_1.xyz;
    roughness = texel_1.w;
    type = uint(texel_2.x + 0.5);
    flags = uint(texel_2.y + 0.5);
    rot = texel_3;
    scale = texel_4.xyz;
}

void getSimpleEntityData(int index, out vec4 rot, out vec3 pos, out vec3 scale, out uint type,
    out uint flags)
{
    int base = index * 5;

    vec4 texel_0 = texelFetch(iEntityTexture, ivec2(base, 0), 0);
    vec4 texel_2 = texelFetch(iEntityTexture, ivec2(base + 2, 0), 0);
    vec4 texel_3 = texelFetch(iEntityTexture, ivec2(base + 3, 0), 0);
    vec4 texel_4 = texelFetch(iEntityTexture, ivec2(base + 4, 0), 0);

    pos = texel_0.xyz;
    type = uint(texel_2.x + 0.5);
    flags = uint(texel_2.y + 0.5);
    rot = texel_3;
    scale = texel_4.xyz;
}

void getMaterial(int index, out vec3 color, out float roughness, out float metallic)
{
    int base = index * 5;

    vec4 texel_0 = texelFetch(iEntityTexture, ivec2(base, 0), 0);
    vec4 texel_1 = texelFetch(iEntityTexture, ivec2(base + 1, 0), 0);

    metallic = texel_0.w;
    color = texel_1.xyz;
    roughness = texel_1.w;
}

float GetDist(vec3 p, out int index)
{
    float minD = 1e20;
    for (int i = 0; i < iEntityCount; i++)
    {
        float d = 1e20;
        vec4 rot;
        vec3 pos, scale;
        uint type, flags;
        getSimpleEntityData(i, rot, pos, scale, type, flags);

        if (flags == 0u)
            continue;

        vec3 localP = quatRotate(quatConjugate(rot), p - pos);

        switch (type)
        {
        case SPHERE:
            d = (length(localP / scale) - 1.0) * min(min(scale.x, scale.y), scale.z);
            break;
        case BOX:
            vec3 q = abs(localP) - scale;
            d = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
            break;
        case PLANE:
            vec3 normal = quatRotate(rot, vec3(0.0, 1.0, 0.0));
            d = dot(p - pos, normal);
            break;
        case TORUS:
            vec2 q_ = vec2(length(localP.xz) - scale.x, localP.y);
            d = length(q_) - scale.y;
            break;
        default:
            d = 1e20;
            break;
        }

        if (d < minD)
        {
            minD = d;
            index = i;
        }
    }
    return minD;
}

float RayMarch(vec3 ro, vec3 rd, out int steps, out int id)
{
    float d = 0.0;
    steps = 0;
    int i = 0;

    for (; i < MAX_STEPS; i++)
    {
        vec3 p = ro + rd * d;
        float dS = GetDist(p, id);
        d += dS;
        if (d > MAX_DIST || abs(dS) < SURF_DIST)
            break;
    }

    steps = i;
    return d;
}

vec3 GetSkyColor(vec3 rd)
{
    float horizon = max(0.0, dot(rd, vec3(0.0, 1.0, 0.0)));
    vec3 sky = mix(vec3(0.03, 0.05, 0.1), vec3(0.4, 0.6, 0.9), horizon);
    vec3 sunDir = normalize(vec3(4.0, 6.0, -3.0));
    float sun = pow(max(0.0, dot(rd, sunDir)), 128.0);
    sky += vec3(1.0, 0.9, 0.7) * sun * 2.0;
    return sky;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float theta = iMouse.x / 100.0;
    float phi = 0.35 + (iMouse.y / 5000.0);
    float dist = iCameraDist;
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 camPos = vec3(
        dist * sin(theta) * cos(phi),
        dist * sin(phi),
        dist * cos(theta) * cos(phi));
    vec3 ro = camPos;                             // Ray Origin
    vec3 f = normalize(target - ro);              // Forward
    vec3 r = normalize(cross(vec3(0, 1, 0), f));  // Right
    vec3 u = cross(f, r);                         // Up
    vec3 rd = normalize(f + uv.x * r + uv.y * u); // Ray Direction

    vec3 mainLightDir = normalize(vec3(4.0, 6.0, -3.0));
    vec3 finalColor = vec3(0.0);
    vec3 throughput = vec3(1.0);

    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++)
    {
        int steps;
        int last_shape_id;
        float d = RayMarch(ro, rd, steps, last_shape_id);

        if (d < MAX_DIST)
        {
            vec3 p = ro + rd * d;
            vec3 baseColor;
            float roughness, metallic;
            getMaterial(last_shape_id, baseColor, roughness, metallic);
            finalColor = baseColor / float(steps);
        }
        else
        {
            finalColor += throughput * GetSkyColor(rd) / float(steps);
            break;
        }
        break;
    }

    finalColor = pow(finalColor, vec3(1.0 / 2.2));
    fragColor = vec4(finalColor, 1.0);
}