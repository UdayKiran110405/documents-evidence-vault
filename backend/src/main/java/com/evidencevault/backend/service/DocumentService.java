package com.evidencevault.backend.service;

import com.evidencevault.backend.dto.DocumentResponse;
import com.evidencevault.backend.dto.DocumentVersionResponse;
import com.evidencevault.backend.entity.Document;
import com.evidencevault.backend.entity.DocumentCategory;
import com.evidencevault.backend.entity.DocumentStatus;
import com.evidencevault.backend.entity.User;
import com.evidencevault.backend.repository.DocumentRepository;
import com.evidencevault.backend.repository.UserRepository;
import com.evidencevault.backend.storage.StorageService;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.transaction.annotation.Transactional;

import com.evidencevault.backend.dto.DocumentDownload;
import com.evidencevault.backend.exception.DocumentIntegrityException;

import com.evidencevault.backend.entity.DocumentVersion;
import com.evidencevault.backend.repository.DocumentVersionRepository;
import com.evidencevault.backend.storage.StoredObjectMetadata;

import org.springframework.core.io.Resource;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import com.evidencevault.backend.exception.DuplicateDocumentException;

import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.evidencevault.backend.storage.StoredObjectVersion;
import java.util.List;

import com.evidencevault.backend.dto.VersionReconciliationResponse;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

import com.evidencevault.backend.dto.VersionIntegrityResponse;

import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

@Service
public class DocumentService {

    private final DocumentRepository documentRepository;
    private final UserRepository userRepository;
    private final StorageService storageService;
    private final long maxFileSize;
    private final AuditService auditService;
    private final DocumentVersionRepository documentVersionRepository;

    private static final Map<String, String> ALLOWED_TYPES = Map.of(
            "pdf", "application/pdf",
            "png", "image/png",
            "jpg", "image/jpeg",
            "jpeg", "image/jpeg",
            "txt", "text/plain"
    );

    public DocumentService(
            DocumentRepository documentRepository,
            DocumentVersionRepository documentVersionRepository,
            UserRepository userRepository,
            StorageService storageService,
            @Value("${app.storage.max-file-size-bytes:10485760}")
            long maxFileSize,
            AuditService auditService) {

        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.userRepository = userRepository;
        this.storageService = storageService;
        this.maxFileSize = maxFileSize;
        this.auditService = auditService;
    }

    @Transactional
    public DocumentResponse upload(
            MultipartFile file,
            DocumentCategory category,
            String description,
            String username) throws IOException {

        validateFile(file);

        User uploader = userRepository.findByUsername(username)
                .orElseThrow(() ->
                        new IllegalArgumentException(
                                "Authenticated user was not found"
                        )
                );

        String originalFilename =
                sanitizeFilename(file.getOriginalFilename());

        String extension = getExtension(originalFilename);

        String expectedContentType = ALLOWED_TYPES.get(extension);

        String actualContentType = file.getContentType();

        if (expectedContentType == null
                || !expectedContentType.equalsIgnoreCase(
                actualContentType == null
                        ? ""
                        : actualContentType
        )) {

            throw new IllegalArgumentException(
                    "Unsupported file type or content type mismatch"
            );
        }

        String checksum = calculateChecksumAndValidate(file, extension);

        if (documentRepository.existsBySha256ChecksumAndStatus(
                checksum,
                DocumentStatus.ACTIVE)) {

            throw new DuplicateDocumentException(
                    "An active document with identical content already exists"
            );
        }

        String storageKey = UUID.randomUUID().toString();

        Document document = new Document();

        document.setOriginalFilename(originalFilename);
        document.setStorageKey(storageKey);
        document.setContentType(expectedContentType);
        document.setFileSizeBytes(file.getSize());
        document.setSha256Checksum(checksum);
        document.setCategory(category);
        document.setDescription(description);
        document.setStatus(DocumentStatus.ACTIVE);
        document.setUploadedBy(uploader);

        boolean fileStored = false;

        try (InputStream inputStream = file.getInputStream()) {

            String versionId = storageService.storeVersioned(
                    storageKey,
                    inputStream,
                    expectedContentType,
                    originalFilename
            );

            fileStored = true;

            Document savedDocument =
                    documentRepository.save(document);

            saveVersionMetadata(
                    savedDocument,
                    versionId,
                    originalFilename,
                    expectedContentType,
                    file.getSize(),
                    checksum
            );

            auditService.record(
                    username,
                    "DOCUMENT_UPLOAD",
                    savedDocument.getId(),
                    "Document uploaded: " + savedDocument.getOriginalFilename()
            );

            return toResponse(savedDocument);

        } catch (Exception exception) {

            if (fileStored) {
                try {
                    storageService.delete(storageKey);
                } catch (IOException cleanupException) {
                    exception.addSuppressed(cleanupException);
                }
            }

            if (exception instanceof IOException ioException) {
                throw ioException;
            }

            throw new IllegalStateException(
                    "Document upload could not be completed",
                    exception
            );
        }
    }

    private void validateFile(MultipartFile file) {

        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException(
                    "Please select a non-empty file"
            );
        }

        if (file.getSize() > maxFileSize) {
            throw new IllegalArgumentException(
                    "File size exceeds the permitted limit"
            );
        }
    }

    private String sanitizeFilename(String filename) {

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException(
                    "Filename is required"
            );
        }

        String safeFilename = filename
                .replace("\\", "/");

        safeFilename = safeFilename.substring(
                safeFilename.lastIndexOf('/') + 1
        );

        safeFilename = safeFilename
                .replaceAll("[\\p{Cntrl}]", "")
                .trim();

        if (safeFilename.isBlank() || safeFilename.length() > 255) {
            throw new IllegalArgumentException(
                    "Invalid filename"
            );
        }

        return safeFilename;
    }

    private String getExtension(String filename) {

        int dotIndex = filename.lastIndexOf('.');

        if (dotIndex < 0 || dotIndex == filename.length() - 1) {
            throw new IllegalArgumentException(
                    "File extension is required"
            );
        }

        return filename.substring(dotIndex + 1)
                .toLowerCase(Locale.ROOT);
    }

    private String calculateChecksumAndValidate(
            MultipartFile file,
            String extension) throws IOException {

        try {

            MessageDigest digest =
                    MessageDigest.getInstance("SHA-256");

            byte[] header;

            try (InputStream inputStream = file.getInputStream()) {

                header = inputStream.readNBytes(8);

                digest.update(header);

                byte[] buffer = new byte[8192];

                int bytesRead;

                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    digest.update(buffer, 0, bytesRead);
                }
            }

            validateFileSignature(header, extension);

            return HexFormat.of().formatHex(digest.digest());

        } catch (NoSuchAlgorithmException exception) {

            throw new IllegalStateException(
                    "SHA-256 algorithm is unavailable",
                    exception
            );
        }
    }

    private void validateFileSignature(
            byte[] header,
            String extension) {

        boolean valid = switch (extension) {

            case "pdf" ->
                    startsWith(header, new byte[]{
                            0x25, 0x50, 0x44, 0x46, 0x2D
                    });

            case "png" ->
                    startsWith(header, new byte[]{
                            (byte) 0x89, 0x50, 0x4E, 0x47,
                            0x0D, 0x0A, 0x1A, 0x0A
                    });

            case "jpg", "jpeg" ->
                    startsWith(header, new byte[]{
                            (byte) 0xFF, (byte) 0xD8, (byte) 0xFF
                    });

            case "txt" ->
                    header.length > 0 && !containsNullByte(header);

            default -> false;
        };

        if (!valid) {
            throw new IllegalArgumentException(
                    "File content does not match its extension"
            );
        }
    }

    private boolean startsWith(byte[] actual, byte[] expected) {

        if (actual.length < expected.length) {
            return false;
        }

        for (int i = 0; i < expected.length; i++) {
            if (actual[i] != expected[i]) {
                return false;
            }
        }

        return true;
    }

    private boolean containsNullByte(byte[] bytes) {

        for (byte value : bytes) {
            if (value == 0) {
                return true;
            }
        }

        return false;
    }

    private DocumentResponse toResponse(Document document) {

        return new DocumentResponse(
                document.getId(),
                document.getOriginalFilename(),
                document.getContentType(),
                document.getFileSizeBytes(),
                document.getSha256Checksum(),
                document.getCategory(),
                document.getDescription(),
                document.getStatus(),
                document.getUploadedBy().getUsername(),
                document.getCreatedAt()
        );
    }

    @Transactional(readOnly = true)
    public Page<DocumentResponse> searchDocuments(
            String keyword,
            DocumentCategory category,
            DocumentStatus status,
            Pageable pageable) {

        String searchKeyword =
                (keyword == null || keyword.isBlank())
                        ? null
                        : keyword.trim();

        return documentRepository.searchDocuments(
                searchKeyword,
                category,
                status,
                pageable
        ).map(this::toResponse);
    }


    @Transactional(noRollbackFor = DocumentIntegrityException.class)
    public DocumentDownload preview(
            Long documentId,
            String username
    ) throws IOException {

        return loadVerifiedDocument(
                documentId,
                username,
                "DOCUMENT_PREVIEW",
                "Document previewed successfully",
                "Document is not available for preview"
        );
    }

    @Transactional(noRollbackFor = DocumentIntegrityException.class)
    public DocumentDownload download(
            Long documentId,
            String username
    ) throws IOException {

        return loadVerifiedDocument(
                documentId,
                username,
                "DOCUMENT_DOWNLOAD",
                "Document downloaded successfully",
                "Document is not available for download"
        );
    }

    private DocumentDownload loadVerifiedDocument(
            Long documentId,
            String username,
            String auditAction,
            String auditDetails,
            String unavailableMessage
    ) throws IOException {

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        // Only ACTIVE documents can be viewed or downloaded.
        if (document.getStatus() != DocumentStatus.ACTIVE) {
            throw new IllegalArgumentException(unavailableMessage);
        }

        // Load the current object from the configured storage provider.
        Resource resource = storageService.load(
                document.getStorageKey()
        );

        String actualChecksum;

        try (InputStream input = resource.getInputStream()) {

            MessageDigest digest = MessageDigest.getInstance("SHA-256");

            byte[] buffer = new byte[8192];

            int bytesRead;

            while ((bytesRead = input.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }

            actualChecksum = HexFormat.of()
                    .formatHex(digest.digest());

        } catch (NoSuchAlgorithmException exception) {

            throw new IllegalStateException(
                    "SHA-256 algorithm is unavailable",
                    exception
            );
        }

        String expectedChecksum = document.getSha256Checksum();

        boolean checksumMatches =
                expectedChecksum != null
                        && MessageDigest.isEqual(
                        expectedChecksum.getBytes(
                                StandardCharsets.US_ASCII
                        ),
                        actualChecksum.getBytes(
                                StandardCharsets.US_ASCII
                        )
                );

        // Never return a document whose integrity check fails.
        if (!checksumMatches) {

            document.setStatus(DocumentStatus.CORRUPTED);

            documentRepository.save(document);

            auditService.record(
                    username,
                    "DOCUMENT_INTEGRITY_FAILURE",
                    documentId,
                    "SHA-256 verification failed. "
                            + "Expected: " + expectedChecksum
                            + "; Actual: " + actualChecksum
            );

            throw new DocumentIntegrityException(
                    "Document integrity verification failed"
            );
        }

        // Record whether the user previewed or downloaded the file.
        auditService.record(
                username,
                auditAction,
                documentId,
                auditDetails
        );

        return new DocumentDownload(
                resource,
                document.getOriginalFilename(),
                document.getContentType()
        );
    }


    @Transactional
    public void softDelete(Long documentId, String username) {

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        if (document.getStatus() == DocumentStatus.DELETED) {
            throw new IllegalArgumentException(
                    "Document is already deleted"
            );
        }

        // Ask S3 to create a Delete Marker.
        String markerVersionId;

        try {
            markerVersionId =
                    storageService.createDeleteMarker(document.getStorageKey());
        } catch (IOException e) {
            throw new IllegalStateException(
                    "Failed to create S3 Delete Marker", e
            );
        }

        // Save the marker ID in MySQL.
        document.setDeleteMarkerVersionId(markerVersionId);

        // Update the application document status.
        document.setStatus(DocumentStatus.DELETED);

        documentRepository.save(document);

        // Record the operation in the audit history.
        auditService.record(
                username,
                "DOCUMENT_SOFT_DELETE",
                document.getId(),
                "S3 Delete Marker created. Marker version ID: "
                        + markerVersionId
        );
    }

    @Transactional
    public void restoreDocument(Long documentId, String username) {

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        if (document.getStatus() != DocumentStatus.DELETED) {
            throw new IllegalArgumentException(
                    "Only deleted documents can be restored"
            );
        }

        String markerVersionId =
                document.getDeleteMarkerVersionId();

        // Find the latest actual file version, excluding Delete Markers.
        StoredObjectVersion latestActualVersion =
                storageService.listVersions(document.getStorageKey())
                        .stream()
                        .filter(version -> !version.deleteMarker())
                        .findFirst()
                        .orElseThrow(() -> new IllegalStateException(
                                "No recoverable document version was found"
                        ));

        String sourceVersionId = latestActualVersion.versionId();

        // Read the metadata belonging to that exact S3 version.
        StoredObjectMetadata metadata =
                storageService.getVersionMetadata(
                        document.getStorageKey(),
                        sourceVersionId
                );

        // Load the selected historical version to calculate its checksum.
        Resource historicalResource;

        try {
            historicalResource = storageService.loadVersion(
                    document.getStorageKey(),
                    sourceVersionId
            );

        } catch (IOException exception) {

            throw new IllegalStateException(
                    "Unable to load the historical S3 document version",
                    exception
            );
        }
        String restoredChecksum;

        try (InputStream input =
                     historicalResource.getInputStream()) {

            MessageDigest digest =
                    MessageDigest.getInstance("SHA-256");

            byte[] buffer = new byte[8192];

            int bytesRead;

            while ((bytesRead = input.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }

            restoredChecksum = HexFormat.of()
                    .formatHex(digest.digest());

        } catch (NoSuchAlgorithmException exception) {

            throw new IllegalStateException(
                    "SHA-256 algorithm is unavailable",
                    exception
            );

        } catch (IOException exception) {

            throw new IllegalStateException(
                    "Unable to read the recoverable document version",
                    exception
            );
        }

        // Restore the selected version and obtain the newly created S3 ID.
        String newVersionId =
                storageService.restoreVersionAndGetId(
                        document.getStorageKey(),
                        sourceVersionId
                );

        // Confirm the restored object is now accessible.
        if (!storageService.exists(document.getStorageKey())) {
            throw new IllegalStateException(
                    "Document recovery failed: object is not accessible"
            );
        }

        // Synchronize the current document metadata with the recovered file.
        document.setOriginalFilename(metadata.originalFilename());
        document.setContentType(metadata.contentType());
        document.setFileSizeBytes(metadata.sizeBytes());
        document.setSha256Checksum(restoredChecksum);
        document.setStatus(DocumentStatus.ACTIVE);
        document.setDeleteMarkerVersionId(null);

        Document savedDocument = documentRepository.save(document);

        // Record the newly created S3 version in MySQL.
        saveVersionMetadata(
                savedDocument,
                newVersionId,
                metadata.originalFilename(),
                metadata.contentType(),
                metadata.sizeBytes(),
                restoredChecksum
        );

        auditService.record(
                username,
                "DOCUMENT_RESTORE",
                documentId,
                "Document recovered from S3 version: "
                        + sourceVersionId
                        + "; new S3 version: "
                        + newVersionId
                        + "; previous Delete Marker: "
                        + markerVersionId
                        + "; SHA-256: "
                        + restoredChecksum
        );
    }


    // CHAPTER 5: S3 VERSION MANAGEMENT

    @Transactional(readOnly = true)
    public List<StoredObjectVersion> getDocumentVersions(
            Long documentId) {

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        return storageService.listVersions(
                document.getStorageKey()
        );
    }

    // CHAPTER 6: S3-MYSQL VERSION RECONCILIATION

    @Transactional(readOnly = true)
    public VersionReconciliationResponse reconcileDocumentVersions(
            Long documentId) {

        // 1. Retrieve document from MySQL.

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        // 2. Retrieve actual S3 object versions.

        List<StoredObjectVersion> s3Versions =
                storageService.listVersions(
                        document.getStorageKey()
                );

        // 3. Retrieve version records from MySQL.

        List<DocumentVersion> databaseVersions =
                documentVersionRepository
                        .findByDocumentIdOrderByIdDesc(documentId);

        // 4. Separate actual S3 versions and Delete Markers.

        Map<String, StoredObjectVersion> s3VersionMap =
                new HashMap<>();

        List<String> deleteMarkerIds = new ArrayList<>();

        for (StoredObjectVersion version : s3Versions) {

            if (version.deleteMarker()) {

                deleteMarkerIds.add(version.versionId());

            } else {

                s3VersionMap.put(
                        version.versionId(),
                        version
                );
            }
        }

        // 5. Create a map of MySQL version records.

        Map<String, DocumentVersion> databaseVersionMap =
                new HashMap<>();

        for (DocumentVersion version : databaseVersions) {

            databaseVersionMap.put(
                    version.getS3VersionId(),
                    version
            );
        }

        // 6. Find database records missing in S3.

        List<String> missingInS3 = new ArrayList<>();

        for (String versionId : databaseVersionMap.keySet()) {

            if (!s3VersionMap.containsKey(versionId)) {

                missingInS3.add(versionId);
            }
        }

        // 7. Find S3 versions missing in MySQL.

        List<String> missingInDatabase = new ArrayList<>();

        for (String versionId : s3VersionMap.keySet()) {

            if (!databaseVersionMap.containsKey(versionId)) {

                missingInDatabase.add(versionId);
            }
        }

        // 8. Compare file sizes for matching version IDs.

        List<VersionReconciliationResponse.SizeMismatch>
                sizeMismatches = new ArrayList<>();

        int matchedVersionCount = 0;

        for (String versionId : s3VersionMap.keySet()) {

            DocumentVersion databaseVersion =
                    databaseVersionMap.get(versionId);

            if (databaseVersion != null) {

                matchedVersionCount++;

                long s3Size =
                        s3VersionMap.get(versionId).sizeBytes();

                long databaseSize =
                        databaseVersion.getFileSizeBytes();

                if (s3Size != databaseSize) {

                    sizeMismatches.add(
                            new VersionReconciliationResponse.SizeMismatch(
                                    versionId,
                                    s3Size,
                                    databaseSize
                            )
                    );
                }
            }
        }

        // 9. Determine reconciliation status.

        boolean consistent =
                missingInS3.isEmpty()
                        && missingInDatabase.isEmpty()
                        && sizeMismatches.isEmpty();

        String status = consistent
                ? "CONSISTENT"
                : "INCONSISTENT";

        String message = consistent
                ? "S3 and MySQL version histories are synchronized."
                : "Version inconsistencies detected between S3 and MySQL.";

        // 10. Return reconciliation report.

        return new VersionReconciliationResponse(

                document.getId(),

                document.getOriginalFilename(),

                status,

                s3VersionMap.size(),

                databaseVersionMap.size(),

                matchedVersionCount,

                missingInS3,

                missingInDatabase,

                sizeMismatches,

                deleteMarkerIds,

                message
        );
    }


    @Transactional(readOnly = true)
    public List<DocumentVersionResponse> getDocumentVersionHistory(
            Long documentId) {

        // Step 1: Verify that the parent document exists.
        documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        // Step 2: Retrieve version records from MySQL.
        List<DocumentVersion> versions =
                documentVersionRepository
                        .findByDocumentIdOrderByIdDesc(documentId);

        // Step 3: Convert database entities into API response DTOs.
        return versions.stream()
                .map(version -> new DocumentVersionResponse(
                        version.getId(),
                        version.getS3VersionId(),
                        version.getOriginalFilename(),
                        version.getContentType(),
                        version.getFileSizeBytes(),
                        version.getSha256Checksum(),
                        version.getCreatedAt()
                ))
                .toList();
    }



// CHAPTER 7: HISTORICAL VERSION INTEGRITY VERIFICATION

    @Transactional(readOnly = true)
    public VersionIntegrityResponse verifyHistoricalVersionIntegrity(
            Long documentId) {

        // 1. Retrieve document from MySQL.

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        // 2. Retrieve all actual S3 versions.

        List<StoredObjectVersion> s3Versions =
                storageService.listVersions(
                        document.getStorageKey()
                );

        // 3. Retrieve all MySQL version records.

        List<DocumentVersion> databaseVersions =
                documentVersionRepository
                        .findByDocumentIdOrderByIdDesc(documentId);

        // 4. Separate S3 object versions and Delete Markers.

        Map<String, StoredObjectVersion> s3VersionMap =
                new HashMap<>();

        List<String> deleteMarkerIds = new ArrayList<>();

        for (StoredObjectVersion version : s3Versions) {

            if (version.deleteMarker()) {

                deleteMarkerIds.add(version.versionId());

            } else {

                s3VersionMap.put(
                        version.versionId(),
                        version
                );
            }
        }

        // 5. Build the MySQL version map.

        Map<String, DocumentVersion> databaseVersionMap =
                new HashMap<>();

        for (DocumentVersion version : databaseVersions) {

            databaseVersionMap.put(
                    version.getS3VersionId(),
                    version
            );
        }

        // 6. Identify versions missing from either system.

        List<String> missingInS3 = new ArrayList<>();

        for (String versionId : databaseVersionMap.keySet()) {

            if (!s3VersionMap.containsKey(versionId)) {
                missingInS3.add(versionId);
            }
        }

        List<String> missingInDatabase = new ArrayList<>();

        for (String versionId : s3VersionMap.keySet()) {

            if (!databaseVersionMap.containsKey(versionId)) {
                missingInDatabase.add(versionId);
            }
        }

        // 7. Verify the actual contents of every matching version.

        List<VersionIntegrityResponse.VersionCheck> checks =
                new ArrayList<>();

        int verifiedCount = 0;

        for (DocumentVersion databaseVersion : databaseVersions) {

            String versionId = databaseVersion.getS3VersionId();

            StoredObjectVersion s3Version =
                    s3VersionMap.get(versionId);

            // Version exists in MySQL but not in S3.

            if (s3Version == null) {

                checks.add(
                        new VersionIntegrityResponse.VersionCheck(
                                versionId,
                                "MISSING_IN_S3",
                                databaseVersion.getFileSizeBytes(),
                                null,
                                databaseVersion.getSha256Checksum(),
                                null,
                                "Database version has no corresponding S3 object version."
                        )
                );

                continue;
            }

            // 8. Retrieve the exact historical S3 version.

            try {

                org.springframework.core.io.Resource resource =
                        storageService.loadVersion(
                                document.getStorageKey(),
                                versionId
                        );

                // 9. Calculate actual SHA-256 and file size.

                MessageDigest digest =
                        MessageDigest.getInstance("SHA-256");

                long actualSize = 0;

                byte[] buffer = new byte[8192];

                try (InputStream input =
                             resource.getInputStream()) {

                    int bytesRead;

                    while ((bytesRead = input.read(buffer)) != -1) {

                        digest.update(buffer, 0, bytesRead);

                        actualSize += bytesRead;
                    }
                }

                String actualChecksum = HexFormat.of()
                        .formatHex(digest.digest());

                // 10. Compare actual values with MySQL.

                String expectedChecksum =
                        databaseVersion.getSha256Checksum();

                long expectedSize =
                        databaseVersion.getFileSizeBytes();

                boolean checksumMatches =
                        expectedChecksum.equalsIgnoreCase(
                                actualChecksum
                        );

                boolean sizeMatches =
                        expectedSize == actualSize;

                String verificationStatus;

                String message;

                if (checksumMatches && sizeMatches) {

                    verificationStatus = "VERIFIED";

                    message = "SHA-256 checksum and file size match.";

                    verifiedCount++;

                } else if (!checksumMatches && !sizeMatches) {

                    verificationStatus =
                            "CHECKSUM_AND_SIZE_MISMATCH";

                    message =
                            "Both SHA-256 checksum and file size differ.";

                } else if (!checksumMatches) {

                    verificationStatus = "CHECKSUM_MISMATCH";

                    message =
                            "Actual SHA-256 checksum differs from MySQL.";

                } else {

                    verificationStatus = "SIZE_MISMATCH";

                    message =
                            "Actual file size differs from MySQL.";
                }

                checks.add(
                        new VersionIntegrityResponse.VersionCheck(

                                versionId,

                                verificationStatus,

                                expectedSize,

                                actualSize,

                                expectedChecksum,

                                actualChecksum,

                                message
                        )
                );

            } catch (java.io.IOException exception) {

                checks.add(
                        new VersionIntegrityResponse.VersionCheck(

                                versionId,

                                "UNREADABLE",

                                databaseVersion.getFileSizeBytes(),

                                null,

                                databaseVersion.getSha256Checksum(),

                                null,

                                "Unable to read the historical S3 version."
                        )
                );

            } catch (NoSuchAlgorithmException exception) {

                throw new IllegalStateException(
                        "SHA-256 algorithm is unavailable",
                        exception
                );
            }
        }

        // 11. Determine overall integrity status.

        boolean allVerified =
                missingInS3.isEmpty()
                        && missingInDatabase.isEmpty()
                        && verifiedCount == databaseVersions.size();

        String integrityStatus = allVerified
                ? "VERIFIED"
                : "INTEGRITY_ISSUES_FOUND";

        String message = allVerified
                ? "All historical document versions passed integrity verification."
                : "One or more historical document versions failed integrity verification or could not be verified.";

        // 12. Return the final integrity report.

        return new VersionIntegrityResponse(

                document.getId(),

                document.getOriginalFilename(),

                integrityStatus,

                s3VersionMap.size(),

                databaseVersionMap.size(),

                verifiedCount,

                checks,

                missingInS3,

                missingInDatabase,

                deleteMarkerIds,

                message
        );
    }




    @Transactional(readOnly = true)
    public DocumentDownload downloadDocumentVersion(
            Long documentId,
            String versionId,
            String username) throws IOException {

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        boolean validVersion = storageService
                .listVersions(document.getStorageKey())
                .stream()
                .anyMatch(version ->
                        version.versionId().equals(versionId)
                                && !version.deleteMarker()
                );

        if (!validVersion) {
            throw new IllegalArgumentException(
                    "Requested document version does not exist"
            );
        }

        Resource resource = storageService.loadVersion(
                document.getStorageKey(),
                versionId
        );

        auditService.record(
                username,
                "DOCUMENT_VERSION_DOWNLOAD",
                documentId,
                "Downloaded historical S3 version: " + versionId
        );

        return new DocumentDownload(
                resource,
                document.getOriginalFilename(),
                document.getContentType()
        );
    }


    // Upload a new S3 version using the document's existing storage key.

    @Transactional
    public DocumentResponse uploadNewVersion(
            Long documentId,
            MultipartFile file,
            String username) throws IOException {

        validateFile(file);

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        if (document.getStatus() != DocumentStatus.ACTIVE) {
            throw new IllegalArgumentException(
                    "Only active documents can receive new versions"
            );
        }

        String originalFilename =
                sanitizeFilename(file.getOriginalFilename());

        String extension = getExtension(originalFilename);

        String expectedContentType = ALLOWED_TYPES.get(extension);

        String actualContentType = file.getContentType();

        if (expectedContentType == null
                || !expectedContentType.equalsIgnoreCase(
                actualContentType == null ? "" : actualContentType
        )) {

            throw new IllegalArgumentException(
                    "Unsupported file type or content type mismatch"
            );
        }

        String checksum = calculateChecksumAndValidate(
                file,
                extension
        );

        String versionId;

        try (InputStream inputStream = file.getInputStream()) {

            versionId = storageService.storeVersioned(
                    document.getStorageKey(),
                    inputStream,
                    expectedContentType,
                    originalFilename
            );
        }
        document.setOriginalFilename(originalFilename);
        document.setContentType(expectedContentType);
        document.setFileSizeBytes(file.getSize());
        document.setSha256Checksum(checksum);
        document.setStatus(DocumentStatus.ACTIVE);

        Document savedDocument = documentRepository.save(document);

        saveVersionMetadata(
                savedDocument,
                versionId,
                originalFilename,
                expectedContentType,
                file.getSize(),
                checksum
        );

        auditService.record(
                username,
                "DOCUMENT_NEW_VERSION_UPLOAD",
                documentId,
                "New S3 version uploaded: " + originalFilename
                        + "; SHA-256: " + checksum
        );

        return toResponse(savedDocument);
    }


    // Restore an existing historical S3 version.

    @Transactional
    public DocumentResponse restoreDocumentVersion(
            Long documentId,
            String versionId,
            String username) throws IOException {

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        boolean validVersion = storageService
                .listVersions(document.getStorageKey())
                .stream()
                .anyMatch(version ->
                        versionId.equals(version.versionId())
                                && !version.deleteMarker()
                );

        if (!validVersion) {
            throw new IllegalArgumentException(
                    "The requested historical version does not exist"
            );
        }

        // Retrieve the selected version's actual S3 metadata.
        StoredObjectMetadata metadata =
                storageService.getVersionMetadata(
                        document.getStorageKey(),
                        versionId
                );

        // Load the historical file and calculate its SHA-256 checksum.
        Resource historicalResource = storageService.loadVersion(
                document.getStorageKey(),
                versionId
        );

        String restoredChecksum;

        try (InputStream input =
                     historicalResource.getInputStream()) {

            MessageDigest digest =
                    MessageDigest.getInstance("SHA-256");

            byte[] buffer = new byte[8192];

            int bytesRead;

            while ((bytesRead = input.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }

            restoredChecksum = HexFormat.of()
                    .formatHex(digest.digest());

        } catch (NoSuchAlgorithmException exception) {

            throw new IllegalStateException(
                    "SHA-256 algorithm is unavailable",
                    exception
            );
        }

        // Copy the selected historical version to create a new latest version.
        String newVersionId =
                storageService.restoreVersionAndGetId(
                        document.getStorageKey(),
                        versionId
                );

        // Update all current document metadata.
        document.setOriginalFilename(metadata.originalFilename());
        document.setContentType(metadata.contentType());
        document.setFileSizeBytes(metadata.sizeBytes());
        document.setSha256Checksum(restoredChecksum);
        document.setStatus(DocumentStatus.ACTIVE);

        document.setDeleteMarkerVersionId(null);

        Document savedDocument = documentRepository.save(document);

        // Record metadata for the newly created restored version.
        saveVersionMetadata(
                savedDocument,
                newVersionId,
                metadata.originalFilename(),
                metadata.contentType(),
                metadata.sizeBytes(),
                restoredChecksum
        );

        auditService.record(
                username,
                "DOCUMENT_VERSION_RESTORE",
                documentId,
                "Restored S3 version: " + versionId
                        + "; new S3 version: " + newVersionId
                        + "; SHA-256: " + restoredChecksum
        );

        return toResponse(savedDocument);
    }

    @Transactional
    public DocumentResponse simulateCorruption(Long documentId, String username) {
        Document document = documentRepository.findById(documentId)
                .orElseThrow(() -> new java.util.NoSuchElementException("Document not found"));

        if (document.getStatus() != DocumentStatus.ACTIVE) {
            throw new IllegalArgumentException("Only ACTIVE documents can be tested for corruption");
        }

        String originalChecksum = document.getSha256Checksum();
        String tamperedChecksum = (originalChecksum.startsWith("0") ? "f" : "0")
                + originalChecksum.substring(1);

        document.setSha256Checksum(tamperedChecksum);
        Document saved = documentRepository.save(document);

        auditService.record(
                username,
                "DOCUMENT_CORRUPTION_SIMULATED",
                documentId,
                "Simulated checksum drift for evaluation drill. Expected digest altered."
        );

        return toResponse(saved);
    }

    @Transactional
    public List<DocumentResponse> seedSyntheticComplianceData(String username) throws IOException {
        User uploader = userRepository.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("Authenticated user was not found"));

        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm is unavailable", e);
        }

        record SeedSample(String filename, DocumentCategory category, String description, String content) {}

        List<SeedSample> samples = List.of(
                new SeedSample(
                        "SOC2-TypeII-Control-Matrix-2026.txt",
                        DocumentCategory.LEGAL,
                        "SOC 2 Type II cryptographic integrity & retention evidence control baseline.",
                        "SOC2 COMPLIANCE EVIDENCE\nControl ID: CC7.4 Disaster Recovery\nTarget RTO: < 5.0 seconds\nPrimary Region: ap-south-1 (Mumbai)\nSecondary Region: ap-southeast-1 (Singapore)\n"
                ),
                new SeedSample(
                        "Q4-Treasury-Reconciliation-Ledger.txt",
                        DocumentCategory.FINANCIAL,
                        "Quarterly statutory treasury reconciliation digest for external audit.",
                        "FINANCIAL AUDIT LEDGER\nPeriod: Q4-2026\nLedger Hash Verification: REQUIRED\nImmutable Retention: 365 Days\n"
                ),
                new SeedSample(
                        "Cloud-Custody-SLA-Agreement.txt",
                        DocumentCategory.CONTRACT,
                        "Executed master service agreement defining 99.99% multi-region durability SLA.",
                        "MASTER CUSTODY SLA\nParties: Compliance Operations & Vault Infrastructure\nCross-Region Replication SLA: < 15 minutes\n"
                ),
                new SeedSample(
                        "INV-2026-0942-Audit-Retainer.txt",
                        DocumentCategory.INVOICE,
                        "External compliance assessment retainer invoice #0942.",
                        "INVOICE #INV-2026-0942\nService: Multi-Region DR & Penetration Assessment\nStatus: VERIFIED\n"
                ),
                new SeedSample(
                        "Incident-Response-Failover-Runbook.txt",
                        DocumentCategory.GENERAL,
                        "Standard operating procedure for Mumbai outage & checksum mismatch recovery.",
                        "DR RUNBOOK v2.4\n1. Verify Singapore replica SHA-256\n2. Copy clean version to Mumbai\n3. Sign JSON Recovery Manifest\n"
                )
        );

        List<DocumentResponse> created = new ArrayList<>();
        for (SeedSample sample : samples) {
            byte[] bytes = sample.content().getBytes(StandardCharsets.UTF_8);
            digest.reset();
            String checksum = HexFormat.of().formatHex(digest.digest(bytes));

            if (documentRepository.existsBySha256ChecksumAndStatus(checksum, DocumentStatus.ACTIVE)) {
                continue;
            }

            String storageKey = UUID.randomUUID().toString();
            String versionId = storageService.storeVersioned(
                    storageKey,
                    new java.io.ByteArrayInputStream(bytes),
                    "text/plain",
                    sample.filename()
            );

            Document doc = new Document();
            doc.setOriginalFilename(sample.filename());
            doc.setStorageKey(storageKey);
            doc.setContentType("text/plain");
            doc.setFileSizeBytes((long) bytes.length);
            doc.setSha256Checksum(checksum);
            doc.setCategory(sample.category());
            doc.setDescription(sample.description());
            doc.setStatus(DocumentStatus.ACTIVE);
            doc.setUploadedBy(uploader);

            Document saved = documentRepository.save(doc);
            saveVersionMetadata(saved, versionId, sample.filename(), "text/plain", bytes.length, checksum);
            auditService.record(username, "DOCUMENT_UPLOAD", saved.getId(), "Synthetic compliance evidence seeded: " + sample.filename());
            created.add(toResponse(saved));
        }

        return created;
    }
    private void saveVersionMetadata(
            Document document,
            String versionId,
            String originalFilename,
            String contentType,
            long sizeBytes,
            String checksum) {

        // Local storage does not generate S3 version IDs.
        if (versionId == null || versionId.isBlank()) {
            return;
        }

        DocumentVersion version = new DocumentVersion();

        version.setDocument(document);
        version.setS3VersionId(versionId);
        version.setOriginalFilename(originalFilename);
        version.setContentType(contentType);
        version.setFileSizeBytes(sizeBytes);
        version.setSha256Checksum(checksum);

        documentVersionRepository.save(version);
    }




}