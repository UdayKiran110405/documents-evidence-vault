package com.evidencevault.backend.dto;

import com.evidencevault.backend.entity.DocumentCategory;
import com.evidencevault.backend.entity.DocumentStatus;

import java.time.LocalDateTime;

public record DocumentResponse(

        Long id,
        String originalFilename,
        String contentType,
        Long fileSizeBytes,
        String sha256Checksum,
        DocumentCategory category,
        String description,
        DocumentStatus status,
        String uploadedBy,
        LocalDateTime createdAt

) {
}