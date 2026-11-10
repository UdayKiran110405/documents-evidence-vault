
package com.evidencevault.backend.storage;

import java.time.Instant;

public record StoredObjectVersion(
        String storageKey,
        String versionId,
        boolean latest,
        Instant lastModified,
        long sizeBytes,
        String eTag,
        boolean deleteMarker
) {
}
