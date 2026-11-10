
package com.evidencevault.backend.storage;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import org.springframework.core.io.Resource;

public interface StorageService {

    void store(String storageKey, InputStream inputStream)
            throws IOException;

    default void store(
            String storageKey,
            InputStream inputStream,
            String contentType,
            String originalFilename) throws IOException {

        store(storageKey, inputStream);
    }

    Resource load(String storageKey) throws IOException;

    boolean exists(String storageKey);

    void delete(String storageKey) throws IOException;

    // S3 version management operations

    default List<StoredObjectVersion> listVersions(
            String storageKey) {

        throw new UnsupportedOperationException(
                "Version listing is not supported by this storage provider"
        );
    }

    default Resource loadVersion(
            String storageKey,
            String versionId) throws IOException {

        throw new UnsupportedOperationException(
                "Version download is not supported by this storage provider"
        );
    }

    default void restoreVersion(
            String storageKey,
            String versionId) {

        throw new UnsupportedOperationException(
                "Version restoration is not supported by this storage provider"
        );
    }

    // Creates an S3 Delete Marker. Local storage keeps its existing
    // database-only soft-delete behaviour.

    default String createDeleteMarker(String storageKey)
            throws IOException {

        throw new UnsupportedOperationException(
                "Delete Markers are supported only by versioned storage"
        );
    }

    default void restoreLatestVersion(String storageKey) {

        if (!exists(storageKey)) {
            throw new IllegalStateException(
                    "No available document exists in storage"
            );
        }
    }

    default String storeVersioned(
            String storageKey,
            InputStream inputStream,
            String contentType,
            String originalFilename
    ) throws IOException {
        store(storageKey, inputStream, contentType, originalFilename);
        return null;
    }

    default StoredObjectMetadata getVersionMetadata(
            String storageKey,
            String versionId
    ) {
        throw new UnsupportedOperationException(
                "Version metadata is not supported by this storage provider"
        );
    }

    default String restoreVersionAndGetId(
            String storageKey,
            String versionId
    ) {
        restoreVersion(storageKey, versionId);
        return null;
    }

    default String restoreLatestVersionAndGetId(String storageKey) {
        restoreLatestVersion(storageKey);
        return null;
    }
}
