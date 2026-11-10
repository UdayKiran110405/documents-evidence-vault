package com.evidencevault.backend.storage;

public record StoredObjectMetadata(
        String originalFilename,
        String contentType,
        long sizeBytes
) {
}