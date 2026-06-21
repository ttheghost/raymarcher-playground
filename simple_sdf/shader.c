// uniform vec2  iResolution;
// uniform float iTime;
// uniform vec4  iMouse;
// uniform sampler2D iEntityTexture;
// uniform int iEntityCount;

#define MAX_STEPS 150
#define MAX_DIST 30.
#define SURF_DIST .001
#define MAX_BOUNCES 6

#define SHADOW_K 12.0
#define AO_STEPS 5
#define AO_STEP_SIZE 0.08
#define AO_STRENGTH 0.85

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

float GetDistSimple(vec3 p)
{
    int dummy;
    return GetDist(p, dummy);
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

vec3 GetNormal(vec3 p)
{
    float d = GetDistSimple(p);
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        GetDistSimple(p + e.xyy) - d,
        GetDistSimple(p + e.yxy) - d,
        GetDistSimple(p + e.yyx) - d));
}

// returns 1.0 = fully lit, 0.0 = fully in shadow
float SoftShadow(vec3 ro, vec3 rd, float tMin, float tMax)
{
    float res = 1.0;
    float t = tMin;
    float ph = 1e20;

    for (int i = 0; i < 64; i++)
    {
        float d = GetDistSimple(ro + rd * t);
        if (d < SURF_DIST * 0.5)
            return 0.0;
        if (t > tMax)
            break;

        float y = d * d / (2.0 * ph);
        float h = sqrt(d * d - y * y);
        res = min(res, SHADOW_K * h / max(0.0, t - y));
        ph = d;
        t += d;
    }
    return clamp(res, 0.0, 1.0);
}

float DistributionGGX(float NdotH, float roughness)
{
    float a = roughness * roughness;
    float a2 = a * a;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * d * d);
}

float GeometrySchlickGGX(float NdotV, float roughness)
{
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

float GeometrySmith(float NdotV, float NdotL, float roughness)
{
    return GeometrySchlickGGX(NdotV, roughness) * GeometrySchlickGGX(NdotL, roughness);
}

vec3 FresnelSchlick(float cosTheta, vec3 F0)
{
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 PBR(vec3 N, vec3 V, vec3 L, vec3 baseColor, float roughness, float metallic, vec3 lightColor)
{
    float NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0)
        return vec3(0.0);

    vec3 H = normalize(V + L);
    float NdotV = max(dot(N, V), 0.0001);
    float NdotH = max(dot(N, H), 0.0);
    float HdotV = max(dot(H, V), 0.0);

    vec3 F0 = mix(vec3(0.04), baseColor, metallic);

    float D = DistributionGGX(NdotH, roughness);
    float G = GeometrySmith(NdotV, NdotL, roughness);
    vec3 F = FresnelSchlick(HdotV, F0);

    vec3 specular = (D * G * F) / max(4.0 * NdotV * NdotL, 0.0001);

    vec3 kD = (1.0 - F) * (1.0 - metallic);
    vec3 diffuse = kD * baseColor / 3.14159265;

    return (diffuse + specular) * lightColor * NdotL;
}

float AmbientOcclusion(vec3 p, vec3 n)
{
    float occ = 0.0;
    float weight = 1.0;
    for (int i = 1; i <= AO_STEPS; i++)
    {
        float dist = float(i) * AO_STEP_SIZE;
        float d = GetDistSimple(p + n * dist);
        occ += weight * (dist - d);
        weight *= 0.5;
    }
    return clamp(1.0 - AO_STRENGTH * occ, 0.0, 1.0);
}

vec3 GetSkyColor(vec3 rd)
{
    float up  = max(0.0, dot(rd, vec3(0, 1, 0)));
    vec3  sky = mix(vec3(0.05, 0.07, 0.12), vec3(0.38, 0.58, 0.88), up);
    vec3  sunDir = normalize(vec3(4.0, 6.0, -3.0));
    float sun    = pow(max(0.0, dot(rd, sunDir)), 256.0);
    float halo   = pow(max(0.0, dot(rd, sunDir)), 8.0);
    sky += vec3(1.0, 0.95, 0.8) * sun  * 8.0;
    sky += vec3(1.0, 0.8,  0.5) * halo * 0.3;
    return sky;
}

vec3 GetAmbient(vec3 N)
{
    float up = N.y * 0.5 + 0.5;
    return mix(vec3(0.04, 0.03, 0.05), vec3(0.18, 0.22, 0.28), up);
}

vec3 FresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness)
{
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float theta = iMouse.x / 100.0;
    float phi = 0.35 + (iMouse.y / 5000.0);
    float dist = iCameraDist;
    vec3 target = vec3(0.0);

    vec3 camPos = vec3(
        dist * sin(theta) * cos(phi),
        dist * sin(phi),
        dist * cos(theta) * cos(phi));
    vec3 ro = camPos;                             // Ray Origin
    vec3 f = normalize(target - ro);              // Forward
    vec3 r = normalize(cross(vec3(0, 1, 0), f));  // Right
    vec3 u = cross(f, r);                         // Up
    vec3 rd = normalize(f + uv.x * r + uv.y * u); // Ray Direction

    vec3 sunDir = normalize(vec3(4.0, 6.0, -3.0));
    vec3 sunColor = vec3(1.0, 0.95, 0.85) * 3.5;
    vec3 skyColor = vec3(0.38, 0.58, 0.88) * 0.6;

    vec3 finalColor = vec3(0.0);
    vec3 throughput = vec3(1.0);

    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++)
    {
        int steps;
        int last_shape_id;
        float d = RayMarch(ro, rd, steps, last_shape_id);

        if (last_shape_id < 0 || d >= MAX_DIST)
        {
            finalColor += throughput * GetSkyColor(rd);
            break;
        }

        vec3 p = ro + rd * d;
        vec3 N = GetNormal(p);
        vec3 V = -rd;

        vec3 baseColor;
        float roughness, metallic;
        getMaterial(last_shape_id, baseColor, roughness, metallic);

        float ao = AmbientOcclusion(p + N * SURF_DIST * 2.0, N);

        vec3 F0 = mix(vec3(0.04), baseColor, metallic);
        float NdotV = max(dot(N, V), 0.0001);
        vec3 kS = FresnelSchlickRoughness(NdotV, F0, roughness);
        vec3 kD = (1.0 - kS) * (1.0 - metallic);
        vec3 ambient = (kD * baseColor * GetAmbient(N)) * ao;
        finalColor += throughput * ambient;

        vec3 shadowOrigin = p + N * SURF_DIST * 3.0;
        float shadow = SoftShadow(shadowOrigin, sunDir, 0.02, 20.0);
        finalColor += throughput * PBR(N, V, sunDir, baseColor, roughness, metallic, sunColor) * shadow;

        vec3 skyDir = normalize(vec3(-sunDir.x, abs(sunDir.y), -sunDir.z) * vec3(-1,1,1));
        finalColor += throughput * PBR(N, V, skyDir, baseColor,
                                       roughness, metallic, skyColor) * ao * 0.5;
 
        vec3 reflWeight = FresnelSchlickRoughness(NdotV, F0, roughness);

        if (roughness > 0.6 || max(reflWeight.r, max(reflWeight.g, reflWeight.b)) < 0.02) break;


        throughput *= reflWeight;

        rd = reflect(rd, N);
        ro = p + N * SURF_DIST * 3.0;
    }

    finalColor = finalColor * (finalColor + 0.0245786) /
                 (finalColor * (0.983729 * finalColor + 0.4329510) + 0.238081);
    finalColor = pow(max(finalColor, 0.0), vec3(1.0 / 2.2));
    fragColor = vec4(finalColor, 1.0);
}