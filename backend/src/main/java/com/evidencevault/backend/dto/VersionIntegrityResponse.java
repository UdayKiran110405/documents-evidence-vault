
package com.evidencevault.backend.dto;

import java.util.List;

public record VersionIntegrityResponse(

        Long documentId,

        String originalFilename,

        String integrityStatus,

        int s3VersionCount,

        int databaseVersionCount,

        int verifiedVersionCount,

        List<VersionCheck> versionChecks,

        List<String> missingInS3,

        List<String> missingInDatabase,

        List<String> deleteMarkerVersionIds,

        String message

) {

    public record VersionCheck(

            String versionId,

            String verificationStatus,

            Long expectedSizeBytes,

            Long actualSizeBytes,

            String expectedSha256,

            String actualSha256,

            String message

    ) {
    }
}
