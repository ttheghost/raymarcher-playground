// uniform vec2  iResolution;
// uniform float iTime;
// uniform vec4  iMouse;
// uniform sampler2D iEntityTexture;
// uniform int iEntityCount;

#define MAX_STEPS 150
#define MAX_DIST 50.
#define SURF_DIST .001
#define MAX_BOUNCES 3

const uint SPHERE = 0u;
const uint BOX = 1u;
const uint PLANE = 2u;

void getEntityData(int index, out vec3 pos, out vec3 color, out float radius,
                   out float roughness, out float metallic, out uint type, out uint flags)
{
    int base = index * 4;

    vec4 texel_0 = texelFetch(iEntityTexture, ivec2(base, 0), 0);
    vec4 texel_1 = texelFetch(iEntityTexture, ivec2(base + 1, 0), 0);
    vec4 texel_2 = texelFetch(iEntityTexture, ivec2(base + 2, 0), 0);

    pos = texel_0.xyz;
    radius = texel_0.w;
    color = texel_1.xyz;
    roughness = texel_1.w;
    metallic = texel_2.x;
    type = uint(texel_2.y + 0.5);
    flags = uint(texel_2.z + 0.5);
}

void getSimpleEntityData(int index, out vec3 pos, out float radius, out uint type, out uint flags)
{
    int base = index * 4;

    vec4 texel_0 = texelFetch(iEntityTexture, ivec2(base, 0), 0);
    vec4 texel_2 = texelFetch(iEntityTexture, ivec2(base + 2, 0), 0);

    pos = texel_0.xyz;
    radius = texel_0.w;
    type = uint(texel_2.y + 0.5);
    flags = uint(texel_2.z + 0.5);
}

void getMaterial(int index, out vec3 color, out float roughness, out float metallic)
{
    int base = index * 4;

    vec4 texel_1 = texelFetch(iEntityTexture, ivec2(base + 1, 0), 0);
    vec4 texel_2 = texelFetch(iEntityTexture, ivec2(base + 2, 0), 0);

    color = texel_1.xyz;
    roughness = texel_1.w;
    metallic = texel_2.x;
}

float GetDist(vec3 p, out int index)
{
    float minD = 1e20;
    for (int i = 0; i < iEntityCount; i++)
    {
        float d = 1e20;
        vec3 pos;
        float radius;
        uint type, flags;
        getSimpleEntityData(i, pos, radius, type, flags);

        if (flags == 0u)
            continue;

        switch (type)
        {
        case SPHERE:
            d = length(p - pos) - radius;
            break;
        case BOX:
            vec3 q = abs(p - pos) - vec3(radius); // radius means size here
            d = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
            break;
        case PLANE:
            vec3 normal = vec3(0.0, 1.0, 0.0);
            d = dot(p - pos, normal);
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
    float dist = 5.0;
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
            finalColor += baseColor;
        }
        else
        {
            finalColor += throughput * GetSkyColor(rd);
            break;
        }
        break;
    }

    finalColor = pow(finalColor, vec3(1.0 / 2.2));
    fragColor = vec4(finalColor, 1.0);
}