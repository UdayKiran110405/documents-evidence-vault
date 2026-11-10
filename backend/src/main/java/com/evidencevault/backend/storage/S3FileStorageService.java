
package com.evidencevault.backend.storage;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;

import software.amazon.awssdk.services.s3.model.CopyObjectResponse;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@Service
@ConditionalOnProperty(
        name = "app.storage.provider",
        havingValue = "s3"
)
public class S3FileStorageService implements StorageService {

    private final S3Client s3Client;
    private final String bucketName;

    public S3FileStorageService(
            S3Client s3Client,
            @Value("${app.storage.s3.bucket}") String bucketName) {

        this.s3Client = s3Client;
        this.bucketName = bucketName;
    }

    @Override
    public void store(
            String storageKey,
            InputStream inputStream) throws IOException {

        store(
                storageKey,
                inputStream,
                "application/octet-stream",
                storageKey
        );
    }

    @Override
    public void store(
            String storageKey,
            InputStream inputStream,
            String contentType,
            String originalFilename
    ) throws IOException {

        storeVersioned(
                storageKey,
                inputStream,
                contentType,
                originalFilename
        );
    }

    @Override
    public String storeVersioned(
            String storageKey,
            InputStream inputStream,
            String contentType,
            String originalFilename
    ) throws IOException {

        validateKey(storageKey);

        byte[] fileBytes = inputStream.readAllBytes();

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucketName)
                .key(storageKey)
                .contentType(contentType)
                .metadata(Map.of(
                        "original-filename",
                        originalFilename
                ))
                .build();

        PutObjectResponse response = s3Client.putObject(
                request,
                RequestBody.fromBytes(fileBytes)
        );

        return response.versionId();
    }

    @Override
    public Resource load(String storageKey) throws IOException {

        validateKey(storageKey);

        GetObjectRequest request = GetObjectRequest.builder()
                .bucket(bucketName)
                .key(storageKey)
                .build();

        ResponseBytes<GetObjectResponse> objectBytes =
                s3Client.getObjectAsBytes(request);

        return new ByteArrayResource(objectBytes.asByteArray());
    }

    @Override
    public Resource loadVersion(
            String storageKey,
            String versionId) throws IOException {

        validateKey(storageKey);
        validateVersionId(versionId);

        GetObjectRequest request = GetObjectRequest.builder()
                .bucket(bucketName)
                .key(storageKey)
                .versionId(versionId)
                .build();

        ResponseBytes<GetObjectResponse> objectBytes =
                s3Client.getObjectAsBytes(request);

        return new ByteArrayResource(objectBytes.asByteArray());
    }

    @Override
    public boolean exists(String storageKey) {

        validateKey(storageKey);

        try {

            s3Client.headObject(
                    HeadObjectRequest.builder()
                            .bucket(bucketName)
                            .key(storageKey)
                            .build()
            );

            return true;

        } catch (NoSuchKeyException exception) {

            return false;

        } catch (S3Exception exception) {

            if (exception.statusCode() == 404) {
                return false;
            }

            throw exception;
        }
    }

    @Override
    public void delete(String storageKey) throws IOException {

        validateKey(storageKey);

        s3Client.deleteObject(
                DeleteObjectRequest.builder()
                        .bucket(bucketName)
                        .key(storageKey)
                        .build()
        );
    }

    @Override
    public String createDeleteMarker(String storageKey) {

        validateKey(storageKey);

        DeleteObjectResponse response = s3Client.deleteObject(
                DeleteObjectRequest.builder()
                        .bucket(bucketName)
                        .key(storageKey)
                        .build()
        );

        return response.versionId();
    }

    @Override
    public List<StoredObjectVersion> listVersions(
            String storageKey) {

        validateKey(storageKey);

        List<StoredObjectVersion> result = new ArrayList<>();

        String keyMarker = null;
        String versionIdMarker = null;

        boolean truncated;

        do {

            ListObjectVersionsRequest.Builder requestBuilder =
                    ListObjectVersionsRequest.builder()
                            .bucket(bucketName)
                            .prefix(storageKey)
                            .maxKeys(1000);

            if (keyMarker != null) {
                requestBuilder.keyMarker(keyMarker);
            }

            if (versionIdMarker != null) {
                requestBuilder.versionIdMarker(versionIdMarker);
            }

            ListObjectVersionsResponse response =
                    s3Client.listObjectVersions(
                            requestBuilder.build()
                    );

            for (ObjectVersion version : response.versions()) {

                if (storageKey.equals(version.key())) {

                    result.add(new StoredObjectVersion(
                            version.key(),
                            version.versionId(),
                            Boolean.TRUE.equals(version.isLatest()),
                            version.lastModified(),
                            version.size() == null ? 0L : version.size(),
                            version.eTag(),
                            false
                    ));
                }
            }

            for (DeleteMarkerEntry marker : response.deleteMarkers()) {

                if (storageKey.equals(marker.key())) {

                    result.add(new StoredObjectVersion(
                            marker.key(),
                            marker.versionId(),
                            Boolean.TRUE.equals(marker.isLatest()),
                            marker.lastModified(),
                            0L,
                            null,
                            true
                    ));
                }
            }

            truncated = Boolean.TRUE.equals(response.isTruncated());

            keyMarker = response.nextKeyMarker();
            versionIdMarker = response.nextVersionIdMarker();

        } while (truncated);

        result.sort(
                Comparator.comparing(
                        StoredObjectVersion::lastModified,
                        Comparator.nullsLast(Comparator.reverseOrder())
                )
        );

        return result;
    }

    @Override
    public void restoreVersion(
            String storageKey,
            String versionId
    ) {
        restoreVersionAndGetId(storageKey, versionId);
    }

    @Override
    public String restoreVersionAndGetId(
            String storageKey,
            String versionId
    ) {

        validateKey(storageKey);
        validateVersionId(versionId);

        StoredObjectVersion selectedVersion = listVersions(storageKey)
                .stream()
                .filter(version -> version.versionId().equals(versionId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Requested S3 version was not found"
                ));

        if (selectedVersion.deleteMarker()) {
            throw new IllegalArgumentException(
                    "Cannot restore a delete marker as a document"
            );
        }

        String encodedSource = URLEncoder.encode(
                storageKey,
                StandardCharsets.UTF_8
        ).replace("+", "%20");

        String encodedVersionId = URLEncoder.encode(
                versionId,
                StandardCharsets.UTF_8
        );

        String copySource = bucketName
                + "/"
                + encodedSource
                + "?versionId="
                + encodedVersionId;

        CopyObjectResponse response = s3Client.copyObject(
                CopyObjectRequest.builder()
                        .copySource(copySource)
                        .destinationBucket(bucketName)
                        .destinationKey(storageKey)
                        .metadataDirective(MetadataDirective.COPY)
                        .build()
        );

        return response.versionId();
    }

    @Override
    public void restoreLatestVersion(String storageKey) {
        restoreLatestVersionAndGetId(storageKey);
    }

    @Override
    public String restoreLatestVersionAndGetId(String storageKey) {

        validateKey(storageKey);

        StoredObjectVersion latestActualVersion = listVersions(storageKey)
                .stream()
                .filter(version -> !version.deleteMarker())
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "No recoverable file version was found"
                ));

        return restoreVersionAndGetId(
                storageKey,
                latestActualVersion.versionId()
        );
    }

    private void validateKey(String storageKey) {

        try {

            UUID.fromString(storageKey);

        } catch (IllegalArgumentException exception) {

            throw new IllegalArgumentException(
                    "Invalid document storage key"
            );
        }
    }

    private void validateVersionId(String versionId) {

        if (versionId == null
                || versionId.isBlank()
                || "null".equalsIgnoreCase(versionId)) {

            throw new IllegalArgumentException(
                    "A valid S3 version ID is required"
            );
        }
    }

    @Override
    public StoredObjectMetadata getVersionMetadata(
            String storageKey,
            String versionId
    ) {

        validateKey(storageKey);
        validateVersionId(versionId);

        HeadObjectResponse response = s3Client.headObject(
                HeadObjectRequest.builder()
                        .bucket(bucketName)
                        .key(storageKey)
                        .versionId(versionId)
                        .build()
        );

        String originalFilename =
                response.metadata().get("original-filename");

        if (originalFilename == null || originalFilename.isBlank()) {
            originalFilename = storageKey;
        }

        String contentType = response.contentType();

        if (contentType == null || contentType.isBlank()) {
            contentType = "application/octet-stream";
        }

        return new StoredObjectMetadata(
                originalFilename,
                contentType,
                response.contentLength()
        );
    }
}
