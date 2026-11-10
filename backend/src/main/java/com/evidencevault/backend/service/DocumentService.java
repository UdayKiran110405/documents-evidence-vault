package com.evidencevault.backend.service;

import com.evidencevault.backend.dto.DocumentResponse;
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
    public DocumentDownload download(
            Long documentId,
            String username) throws IOException {

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() ->
                        new java.util.NoSuchElementException(
                                "Document not found"
                        )
                );

        if (document.getStatus() != DocumentStatus.ACTIVE) {
            throw new IllegalArgumentException(
                    "Document is not available for download"
            );
        }

        Resource resource = storageService.load(
                document.getStorageKey()
        );

        String actualChecksum;

        try (InputStream input = resource.getInputStream()) {

            MessageDigest digest =
                    MessageDigest.getInstance("SHA-256");

            byte[] buffer = new byte[8192];

            int bytesRead;

            while ((bytesRead = input.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }

            actualChecksum = HexFormat.of()
                    .formatHex(digest.digest());

        } catch (java.security.NoSuchAlgorithmException exception) {

            throw new IllegalStateException(
                    "SHA-256 algorithm is unavailable",
                    exception
            );
        }

        boolean checksumMatches = MessageDigest.isEqual(
                document.getSha256Checksum().getBytes(StandardCharsets.US_ASCII),
                actualChecksum.getBytes(StandardCharsets.US_ASCII)
        );

        if (!checksumMatches) {

            document.setStatus(DocumentStatus.CORRUPTED);

            documentRepository.save(document);

            throw new DocumentIntegrityException(
                    "Document integrity verification failed"
            );
        }

        auditService.record(
                username,
                "DOCUMENT_DOWNLOAD",
                document.getId(),
                "Document downloaded successfully"
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