package com.evidencevault.backend.dto;

import java.util.List;

public record VersionReconciliationResponse(

        Long documentId,

        String originalFilename,

        String reconciliationStatus,

        int s3VersionCount,

        int databaseVersionCount,

        int matchedVersionCount,

        List<String> missingInS3,

        List<String> missingInDatabase,

        List<SizeMismatch> sizeMismatches,

        List<String> deleteMarkerVersionIds,

        String message

) {

    public record SizeMismatch(
            String versionId,
            long s3SizeBytes,
            long databaseSizeBytes
    ) {
    }
}