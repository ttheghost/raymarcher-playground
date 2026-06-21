const EntityType = {
  SPHERE: 0,
  BOX: 1,
  PLANE: 2,
  TORUS: 3
};

const Flags = {
  ACTIVE: 1
};

function eulerToQuaternion({ x, y, z }) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);

  return {
    x:  sx * cy * cz + cx * sy * sz,
    y:  cx * sy * cz - sx * cy * sz,
    z:  cx * cy * sz + sx * sy * cz,
    w:  cx * cy * cz - sx * sy * sz,
  };
}

class Entities {
  constructor(maxEntities = 256) {
    this.maxEntities = maxEntities;
    this.entities = [];
    this.freeSlots = [];
    this.nextId = 0;
  }

  add(rotation, position, baseColor, scale, roughness, metallic, type, flags) {
    if (this.entities.length >= this.maxEntities) {
      console.warn('Entities: max capacity reached');
      return -1;
    }

    const entity = {
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z }, // euler
      position: { x: position.x, y: position.y, z: position.z },
      baseColor: { r: baseColor.r, g: baseColor.g, b: baseColor.b },
      scale: { x: scale.x, y: scale.y, z: scale.z },
      roughness: roughness,
      metallic: metallic,
      type: type,
      flags: flags
    };

    let id;
    if (this.freeSlots.length > 0) {
      id = this.freeSlots.pop();
      this.entities[id] = entity;
    } else {
      id = this.nextId++;
      this.entities.push(entity);
    }
    return id;
  }

  get(id) {
    return this.entities[id] || null;
  }

  update(id, rotation, position, baseColor, scale, roughness, metallic, type, flags) {
    if (id >= this.entities.length || !this.entities[id]) {
      console.warn(`Entities: invalid ID ${id}`);
      return false;
    }

    const e = this.entities[id];

    if (rotation) {
      e.rotation.x = rotation.x;
      e.rotation.y = rotation.y;
      e.rotation.z = rotation.z;
    }
    if (position) {
      e.position.x = position.x;
      e.position.y = position.y;
      e.position.z = position.z;
    }
    if (baseColor) {
      e.baseColor.r = baseColor.r;
      e.baseColor.g = baseColor.g;
      e.baseColor.b = baseColor.b;
    }
    if (scale) {
      e.scale.x = scale.x;
      e.scale.y = scale.y;
      e.scale.z = scale.z;
    }
    if (roughness !== undefined) e.roughness = roughness;
    if (metallic !== undefined) e.metallic = metallic;
    if (type !== undefined) e.type = type;
    if (flags !== undefined) e.flags = flags;
    return true;
  }

  remove(id) {
    if (id >= this.entities.length || !this.entities[id]) {
      console.warn(`Entities: invalid ID ${id}`);
      return false;
    }

    this.entities[id] = null;
    this.freeSlots.push(id);
    return true;
  }

  count() {
    return this.entities.filter(e => e !== null).length;
  }

  toF32Array() {
    const totalSize = this.maxEntities * 4 * 5; // 5 texels per entity, 4 floats per texel
    let arr = new Float32Array(totalSize);
    let offset = 0;

    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e === null) continue;

      const quat = eulerToQuaternion(e.rotation);

      const base = offset * 4 * 5;
      // Texel 0: position + metallic
      arr[base + 0] = e.position.x;
      arr[base + 1] = e.position.y;
      arr[base + 2] = e.position.z;
      arr[base + 3] = e.metallic;

      // Texel 1: baseColor + roughness
      arr[base + 4] = e.baseColor.r;
      arr[base + 5] = e.baseColor.g;
      arr[base + 6] = e.baseColor.b;
      arr[base + 7] = e.roughness;

      // Texel 2: type + flags + padding
      arr[base + 8] = e.type;
      arr[base + 9] = e.flags;
      arr[base + 10] = 0.0;
      arr[base + 11] = 0.0;

      // Texel 3: quaternion rotation
      arr[base + 12] = quat.x;
      arr[base + 13] = quat.y;
      arr[base + 14] = quat.z;
      arr[base + 15] = quat.w;

      // Texel 4: scale + padding
      arr[base + 16] = e.scale.x;
      arr[base + 17] = e.scale.y;
      arr[base + 18] = e.scale.z;
      arr[base + 19] = 0.0;

      offset++;
    }

    return arr;
  }

  clear() {
    this.entities = [];
    this.freeSlots = [];
    this.nextId = 0;
  }
}

export { Entities, EntityType };
