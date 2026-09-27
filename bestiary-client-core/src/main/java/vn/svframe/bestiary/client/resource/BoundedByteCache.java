package vn.svframe.bestiary.client.resource;

import java.util.LinkedHashMap;
import java.util.Map;

public final class BoundedByteCache {
    private final long maxBytes;
    private final LinkedHashMap<String, byte[]> entries = new LinkedHashMap<>(128, 0.75f, true);
    private long currentBytes;

    public BoundedByteCache(long maxBytes) {
        this.maxBytes = Math.max(0L, maxBytes);
    }

    public synchronized byte[] get(String key) {
        return entries.get(key);
    }

    public synchronized void put(String key, byte[] value) {
        if (value == null || value.length == 0 || value.length > maxBytes || maxBytes == 0L) return;

        byte[] previous = entries.put(key, value);
        if (previous != null) currentBytes -= previous.length;
        currentBytes += value.length;

        while (currentBytes > maxBytes && !entries.isEmpty()) {
            Map.Entry<String, byte[]> eldest = entries.entrySet().iterator().next();
            currentBytes -= eldest.getValue().length;
            entries.remove(eldest.getKey());
            ZipResourceCache.recordEviction();
        }
    }

    public synchronized void clear() {
        entries.clear();
        currentBytes = 0L;
    }

    public synchronized int entryCount() {
        return entries.size();
    }

    public synchronized long currentBytes() {
        return currentBytes;
    }
}
