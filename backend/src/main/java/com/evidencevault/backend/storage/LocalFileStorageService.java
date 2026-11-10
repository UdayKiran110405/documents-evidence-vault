package com.evidencevault.backend.storage;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.regex.Pattern;

@Service
@ConditionalOnProperty(
        name = "app.storage.provider",
        havingValue = "local",
        matchIfMissing = true
)
public class LocalFileStorageService implements StorageService {

    private static final Pattern STORAGE_KEY_PATTERN =
            Pattern.compile(
                    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
            );

    private final Path storageRoot;

    public LocalFileStorageService(
            @Value("${app.storage.local-root:./data/documents}")
            String storageLocation) {

        this.storageRoot = Path.of(storageLocation)
                .toAbsolutePath()
                .normalize();
    }

    @Override
    public void store(
            String storageKey,
            InputStream inputStream) throws IOException {

        Path destination = resolveSafePath(storageKey);

        Files.createDirectories(storageRoot);

        // Do not overwrite an existing stored object.
        try (InputStream input = inputStream) {
            Files.copy(input, destination);
        }
    }

    @Override
    public Resource load(String storageKey) throws IOException {

        Path filePath = resolveSafePath(storageKey);

        if (!Files.isRegularFile(filePath)) {
            throw new FileNotFoundException(
                    "Stored document was not found"
            );
        }

        return new FileSystemResource(filePath);
    }

    @Override
    public boolean exists(String storageKey) {

        try {
            Path filePath = resolveSafePath(storageKey);

            return Files.isRegularFile(filePath);

        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private Path resolveSafePath(String storageKey) {

        if (storageKey == null
                || !STORAGE_KEY_PATTERN.matcher(storageKey).matches()) {

            throw new IllegalArgumentException(
                    "Invalid storage key"
            );
        }

        Path resolvedPath = storageRoot
                .resolve(storageKey)
                .normalize();

        if (!resolvedPath.startsWith(storageRoot)) {
            throw new IllegalArgumentException(
                    "Invalid storage path"
            );
        }

        return resolvedPath;
    }

    @Override
    public void delete(String storageKey) throws IOException {

        Path filePath = resolveSafePath(storageKey);

        Files.deleteIfExists(filePath);
    }
}