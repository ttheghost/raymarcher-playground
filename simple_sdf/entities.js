class Entities {
  constructor(maxEntities = 256) {
    this.maxEntities = maxEntities;
    this.entities = [];
    this.freeSlots = [];
    this.nextId = 0;
  }

  add(position, baseColor, radius, roughness, metallic, type, flags) {
    if (this.entities.length >= this.maxEntities) {
      console.warn('Entities: max capacity reached');
      return -1;
    }

    const entity = {
      position: { x: position.x, y: position.y, z: position.z },
      baseColor: { r: baseColor.r, g: baseColor.g, b: baseColor.b },
      radius: radius,
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

  update(id, position, baseColor, radius, roughness, metallic, type, flags) {
    if (id >= this.entities.length || !this.entities[id]) {
      console.warn(`Entities: invalid ID ${id}`);
      return false;
    }

    const e = this.entities[id];

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
    if (radius !== undefined) e.radius = radius;
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
    const totalSize = this.maxEntities * 16;
    let arr = new Float32Array(totalSize);
    let offset = 0;
    
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e === null) continue;

      const base = offset * 16;
      // Texel 0: position + radius
      arr[base + 0] = e.position.x;
      arr[base + 1] = e.position.y;
      arr[base + 2] = e.position.z;
      arr[base + 3] = e.radius;

      // Texel 1: baseColor + roughness
      arr[base + 4] = e.baseColor.r;
      arr[base + 5] = e.baseColor.g;
      arr[base + 6] = e.baseColor.b;
      arr[base + 7] = e.roughness;

      // Texel 2: metallic + type + flags + padding
      arr[base + 8] = e.metallic;
      arr[base + 9] = e.type;
      arr[base + 10] = e.flags;
      arr[base + 11] = 0.0;

      // Texel 3: padding (for future use)
      arr[base + 12] = 0.0;
      arr[base + 13] = 0.0;
      arr[base + 14] = 0.0;
      arr[base + 15] = 0.0;

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

export { Entities };
