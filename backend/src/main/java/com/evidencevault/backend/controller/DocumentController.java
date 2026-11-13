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

import com.evidencevault.backend.dto.DocumentVersionResponse;

import com.evidencevault.backend.dto.VersionReconciliationResponse;

import com.evidencevault.backend.dto.VersionIntegrityResponse;
import org.springframework.web.server.ResponseStatusException;
import java.util.Locale;

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

            @RequestParam("category") String  category,

            @RequestParam(
                    value = "description",
                    required = false
            ) String description,

            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentResponse response = documentService.upload(
                file,
                parseCategory(category, true),
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

            @RequestParam(required = false) String category,

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
                        parseCategory(category, false),
                        status,
                        pageable
                )
        );
    }


    // Preview a document inside the browser.
    @GetMapping("/{id}/preview")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')"
    )
    public ResponseEntity<org.springframework.core.io.Resource>
    previewDocument(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentDownload preview = documentService.preview(
                id,
                jwt.getSubject()
        );

        ContentDisposition disposition = ContentDisposition
                .inline()
                .filename(
                        preview.filename(),
                        StandardCharsets.UTF_8
                )
                .build();

        return ResponseEntity.ok()
                .contentType(
                        MediaType.parseMediaType(
                                preview.contentType()
                        )
                )
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        disposition.toString()
                )
                .header(
                        HttpHeaders.CACHE_CONTROL,
                        "private, no-store, no-cache, must-revalidate, max-age=0"
                )
                .header("Pragma", "no-cache")
                .header("X-Content-Type-Options", "nosniff")
                .body(preview.resource());
    }


    // Download a document as an attachment.
    @GetMapping("/{id}/download")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')"
    )
    public ResponseEntity<org.springframework.core.io.Resource>
    downloadDocument(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt
    ) throws IOException {

        DocumentDownload download = documentService.download(
                id,
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
                .header(
                        HttpHeaders.CACHE_CONTROL,
                        "private, no-store, no-cache, must-revalidate, max-age=0"
                )
                .header("Pragma", "no-cache")
                .header("X-Content-Type-Options", "nosniff")
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


    @GetMapping("/{id}/version-history")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')"
    )
    public ResponseEntity<List<DocumentVersionResponse>>
    getDocumentVersionHistory(@PathVariable Long id) {

        return ResponseEntity.ok(
                documentService.getDocumentVersionHistory(id)
        );
    }

    // CHAPTER 6: S3-MYSQL VERSION RECONCILIATION

    @GetMapping("/{id}/version-reconciliation")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')"
    )
    public ResponseEntity<VersionReconciliationResponse>
    reconcileDocumentVersions(
            @PathVariable Long id) {

        return ResponseEntity.ok(
                documentService.reconcileDocumentVersions(id)
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


// CHAPTER 7: HISTORICAL VERSION INTEGRITY VERIFICATION

    @GetMapping("/{id}/version-integrity")
    @PreAuthorize(
            "hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR', 'ROLE_AUDITOR')"
    )
    public ResponseEntity<VersionIntegrityResponse>
    verifyHistoricalVersionIntegrity(
            @PathVariable Long id) {

        return ResponseEntity.ok(
                documentService.verifyHistoricalVersionIntegrity(id)
        );
    }

    @PostMapping("/seed-demo")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public ResponseEntity<List<DocumentResponse>> seedDemoDocuments(
            @AuthenticationPrincipal Jwt jwt) throws IOException {
        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(documentService.seedSyntheticComplianceData(jwt.getSubject()));
    }

    private DocumentCategory parseCategory(
            String category,
            boolean required
    ) {
        if (category == null || category.isBlank()) {
            if (required) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Please select a document category before uploading."
                );
            }

            return null;
        }

        try {
            return DocumentCategory.valueOf(
                    category.trim().toUpperCase(Locale.ROOT)
            );

        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "The selected category is not supported. "
                            + "Please choose General, Contract, Invoice, "
                            + "Legal, Financial, or Other."
            );
        }
    }

    @PostMapping("/{id}/simulate-corruption")
    @PreAuthorize("hasAnyAuthority('ROLE_ADMIN', 'ROLE_OPERATOR')")
    public ResponseEntity<DocumentResponse> simulateDocumentCorruption(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt
    ) {
        return ResponseEntity.ok(
                documentService.simulateCorruption(id, jwt.getSubject())
        );
    }





}