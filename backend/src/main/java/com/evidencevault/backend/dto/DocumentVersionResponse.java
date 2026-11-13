
package com.evidencevault.backend.dto;

import java.time.LocalDateTime;

public record DocumentVersionResponse(
        Long recordId,
        String s3VersionId,
        String originalFilename,
        String contentType,
        Long fileSizeBytes,
        String sha256Checksum,
        LocalDateTime createdAt
) {
}
