class UuidCache {
  constructor(nowProvider = () => Date.now()) {
    this.now = nowProvider;
    this.cache = new Map();
  }

  getFreshEntries(uuids = [], ttl = 0) {
    const freshEntries = new Map();
    const now = this.now();

    uuids.forEach(uuid => {
      const entry = this.cache.get(uuid);
      if (!entry) {
        return;
      }

      if (now - entry.timestamp < ttl) {
        freshEntries.set(uuid, { ...entry.value, cached: true });
      } else {
        this.cache.delete(uuid);
      }
    });

    return freshEntries;
  }

  set(uuid, value) {
    if (!uuid) {
      return;
    }
    const timestamp = this.now();
    const cachedValue = { ...value, timestamp };
    this.cache.set(uuid, { value: cachedValue, timestamp });
  }

  setMany(results = []) {
    results.forEach(result => this.set(result.uuid, result));
  }

  clear() {
    this.cache.clear();
  }
}

export { UuidCache };
