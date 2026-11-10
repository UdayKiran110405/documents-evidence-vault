package com.evidencevault.backend.controller;

import com.evidencevault.backend.dto.DocumentResponse;
import com.evidencevault.backend.entity.DocumentCategory;
import com.evidencevault.backend.service.DocumentService;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import com.evidencevault.backend.entity.DocumentStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import com.evidencevault.backend.dto.DocumentDownload;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ContentDisposition;

import java.nio.charset.StandardCharsets;

import com.evidencevault.backend.storage.StoredObjectVersion;
import java.util.List;



import java.io.IOException;

@RestController
@RequestMapping("/api/v1/documents")
public class DocumentController {

    private final DocumentService documentService;

    public DocumentController(DocumentService documentService) {
        this.documentService = documentService;
    }

    @PostMapping(
            value = "/upload",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE
    )
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public ResponseEntity<DocumentResponse> uploadDocument(

            @RequestParam("file") MultipartFile file,

            @RequestParam("category") DocumentCategory category,

            @RequestParam(
                    value = "description",
                    required = false
            ) String description,

            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentResponse response = documentService.upload(
                file,
                category,
                description,
                jwt.getSubject()
        );

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(response);
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')")
    public ResponseEntity<Page<DocumentResponse>> getDocuments(

            @RequestParam(required = false) String keyword,

            @RequestParam(required = false) DocumentCategory category,

            @RequestParam(required = false) DocumentStatus status,

            @RequestParam(defaultValue = "0") int page,

            @RequestParam(defaultValue = "10") int size) {

        if (page < 0 || size < 1 || size > 100) {
            throw new IllegalArgumentException(
                    "Invalid pagination parameters"
            );
        }

        Pageable pageable = PageRequest.of(page, size);

        return ResponseEntity.ok(
                documentService.searchDocuments(
                        keyword,
                        category,
                        status,
                        pageable
                )
        );
    }

    @GetMapping("/{id}/download")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')")
    public ResponseEntity<org.springframework.core.io.Resource> downloadDocument(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentDownload download = documentService.download(
                id,
                jwt.getSubject()
        );

        ContentDisposition disposition = ContentDisposition
                .attachment()
                .filename(download.filename(), StandardCharsets.UTF_8)
                .build();

        return ResponseEntity.ok()
                .contentType(
                        MediaType.parseMediaType(download.contentType())
                )
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        disposition.toString()
                )
                .body(download.resource());
    }


    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public ResponseEntity<Void> deleteDocument(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        documentService.softDelete(id, jwt.getSubject());

        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/restore")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public ResponseEntity<Void> restoreDocument(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        documentService.restoreDocument(id, jwt.getSubject());

        return ResponseEntity.ok().build();
    }


    // CHAPTER 5: LIST S3 VERSIONS

    @GetMapping("/{id}/versions")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')"
    )
    public ResponseEntity<List<StoredObjectVersion>> listVersions(
            @PathVariable Long id) {

        return ResponseEntity.ok(
                documentService.getDocumentVersions(id)
        );
    }

    // CHAPTER 5: DOWNLOAD A HISTORICAL VERSION

    @GetMapping("/{id}/versions/{versionId}/download")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')"
    )
    public ResponseEntity<org.springframework.core.io.Resource>
    downloadVersion(
            @PathVariable Long id,
            @PathVariable String versionId,
            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentDownload download =
                documentService.downloadDocumentVersion(
                        id,
                        versionId,
                        jwt.getSubject()
                );

        ContentDisposition disposition = ContentDisposition
                .attachment()
                .filename(
                        download.filename(),
                        StandardCharsets.UTF_8
                )
                .build();

        return ResponseEntity.ok()
                .contentType(
                        MediaType.parseMediaType(
                                download.contentType()
                        )
                )
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        disposition.toString()
                )
                .body(download.resource());
    }


    // Upload a new version of an existing document.

    @PostMapping(
            value = "/{id}/versions",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE
    )
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')"
    )
    public ResponseEntity<DocumentResponse> uploadNewVersion(
            @PathVariable Long id,
            @RequestParam("file") MultipartFile file,
            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentResponse response =
                documentService.uploadNewVersion(
                        id,
                        file,
                        jwt.getSubject()
                );

        return ResponseEntity.ok(response);
    }


    // Restore a selected historical S3 version.

    @PostMapping("/{id}/versions/{versionId}/restore")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')"
    )
    public ResponseEntity<DocumentResponse> restoreVersion(
            @PathVariable Long id,
            @PathVariable String versionId,
            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentResponse response =
                documentService.restoreDocumentVersion(
                        id,
                        versionId,
                        jwt.getSubject()
                );

        return ResponseEntity.ok(response);
    }





}